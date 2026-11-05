import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { posix, win32 } from "node:path";
import { stat } from "node:fs/promises";
import { assertWorkspaceRelative, buildTree, type ListedPath, type GitState } from "./tree-model";
import type { ActivePathActivity, ActivitySnapshotInput, ActivitySnapshotOutput, ListTreeInput, ListTreeOutput } from "./contracts";
import { PREVIEW_MAX_BYTES, prefsSchema } from "./contracts";
import type { ActivityOutput, FilePreviewInput, FilePreviewOutput, Prefs, TreeGitInput, TreeGitOutput, TreeOutput, WorkspaceOutput } from "./contracts";
import { collectActiveActivities } from "./activity-model";
import { z } from "zod";

const gitFileSchema = z.object({
  path: z.string(),
  previousPath: z.string().nullable(),
  changeKind: z.enum(["added", "modified", "deleted", "renamed", "copied", "type_changed"]),
  additions: z.number(),
  deletions: z.number(),
  binary: z.boolean(),
  origin: z.enum(["tracked", "untracked"]),
  loadMode: z.enum(["auto", "on_demand", "too_large"]),
  revision: z.string(),
});

const gitFilesOutputSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("available"),
    files: z.array(gitFileSchema),
    truncated: z.boolean(),
    shortstat: z.string(),
    mergeBaseRef: z.string().nullable(),
    initialPatches: z.array(
      z.object({ path: z.string(), patch: z.string(), truncated: z.boolean() }),
    ),
  }),
  z.object({
    outcome: z.literal("not_applicable"),
    reason: z.literal("non_git_environment"),
    message: z.string(),
  }),
  z.object({
    outcome: z.literal("unavailable"),
    failure: z.object({
      code: z.string(),
      workspacePath: z.string(),
      message: z.string(),
    }),
  }),
]);

function mapGitState(changeKind: z.infer<typeof gitFileSchema>["changeKind"], origin: "tracked" | "untracked"): GitState {
  if (origin === "untracked") return "untracked";
  switch (changeKind) {
    case "added":
    case "copied":
      return "added";
    case "deleted":
      return "deleted";
    case "renamed":
      return "renamed";
    case "modified":
    case "type_changed":
      return "modified";
  }
}

type DiffStats = { additions: number; deletions: number };

function addDiffStats(target: Map<string, DiffStats>, path: string, additions: number, deletions: number) {
  const previous = target.get(path) ?? { additions: 0, deletions: 0 };
  target.set(path, {
    additions: previous.additions + additions,
    deletions: previous.deletions + deletions,
  });
}

const finishedChangeSchema = z.object({
  id: z.string().min(1), kind: z.literal("work"), workKind: z.literal("file-change"),
  status: z.enum(["completed", "error", "interrupted"]), change: z.object({ path: z.string() }),
});
const turnChildrenSchema = z.object({ kind: z.literal("turn"), children: z.array(z.unknown()) });

function completedFileChanges(rows: readonly unknown[]): ActivePathActivity[] {
  const changes: ActivePathActivity[] = [];
  for (const row of rows) {
    const turn = turnChildrenSchema.safeParse(row);
    if (turn.success) { changes.push(...completedFileChanges(turn.data.children)); continue; }
    const parsed = finishedChangeSchema.safeParse(row);
    if (!parsed.success) continue;
    try {
      assertWorkspaceRelative(parsed.data.change.path);
      changes.push({ activityId: parsed.data.id, path: parsed.data.change.path, kind: "write", status: parsed.data.status });
    } catch { /* Ignore invalid timeline paths at the same boundary as pending activity. */ }
  }
  return changes;
}

export function createServerData(bb: BbPluginApi) {
  const defaultPrefs: Prefs = { showDiff: true, showSize: false, showMtime: false, showFullPath: false, useNerdFontIcons: false, autoCollapse: true };

  async function workspace(input: { threadId: string; environmentId: string }): Promise<WorkspaceOutput> {
    const environment = await bb.sdk.environments.get({ environmentId: input.environmentId });
    return {
      rootPath: environment.path ?? "",
      hostId: environment.hostId,
      branchName: environment.branchName,
      isGitRepo: environment.isGitRepo,
    };
  }

  async function tree(input: { rootPath: string; hostId: string }): Promise<TreeOutput> {
    if (!input.rootPath) return { entries: [], truncated: false };
    const result = await bb.sdk.files.listPaths({
      hostId: input.hostId,
      path: input.rootPath,
      includeFiles: true,
      includeDirectories: true,
      includeHidden: true,
      excludeNames: [],
      limit: 10_000,
    });
    const root = posix.normalize(input.rootPath).replace(/\/$/, "");
    const entries = result.paths.flatMap((entry) => {
      const absolute = entry.path.replaceAll("\\", "/");
      const prefix = `${root}/`;
      const relative = absolute === root ? "" : absolute.startsWith(prefix) ? absolute.slice(prefix.length) : entry.name;
      return relative ? [{ path: relative, kind: entry.kind }] : [];
    }).sort((left, right) => left.path.localeCompare(right.path));
    return { entries, truncated: entries.length >= 10_000 };
  }

  async function prefsGet(): Promise<Prefs> {
    const stored = await bb.storage.kv.get<unknown>("prefs");
    return prefsSchema.parse({ ...defaultPrefs, ...(stored && typeof stored === "object" ? stored : {}) });
  }

  async function prefsSet(input: Prefs): Promise<Prefs> {
    await bb.storage.kv.set("prefs", input);
    return input;
  }

  async function stats(input: { rootPath: string; paths: string[] }) {
    const root = posix.normalize(input.rootPath).replace(/\/$/, "");
    const entries = await Promise.all(input.paths.map(async (path) => {
      try {
        assertWorkspaceRelative(path);
        const file = await stat(posix.join(root, ...path.split("/")));
        return { path, size: file.size, mtimeMs: file.mtimeMs };
      } catch {
        return { path, size: null, mtimeMs: null };
      }
    }));
    return { entries };
  }
  async function readGit(environmentId: string) {
    // Git is optional annotation data. Its failure must not hide the directory.
    let gitAvailable: "available" | "not_applicable" | "unavailable" = "unavailable";
    const changed = new Map<string, GitState>();
    const changedFolders = new Set<string>();
    const changedStats = new Map<string, DiffStats>();
    try {
      const git = await bb.sdk.plugins.callRpc({
        pluginId: "bb--git",
        method: "files",
        input: {
          environmentId,
          target: { type: "uncommitted" },
          ignoreWhitespace: false,
        },
        outputSchema: gitFilesOutputSchema,
      });
      gitAvailable = git.outcome;
      if (git.outcome === "available") {
        for (const file of git.files) {
          try {
            const segments = assertWorkspaceRelative(file.path);
            changed.set(file.path, mapGitState(file.changeKind, file.origin));
            addDiffStats(changedStats, file.path, file.additions, file.deletions);
            for (let i = 1; i < segments.length; i++) {
              const folder = segments.slice(0, i).join("/");
              changedFolders.add(folder);
              addDiffStats(changedStats, folder, file.additions, file.deletions);
            }
            if (file.previousPath !== null) {
              const previous = assertWorkspaceRelative(file.previousPath);
              for (let i = 1; i < previous.length; i++) {
                changedFolders.add(previous.slice(0, i).join("/"));
              }
            }
          } catch {
            // Ignore malformed annotation paths rather than polluting membership.
          }
        }
      }
    } catch {
      // Keep the requested filesystem listing available without Git markers.
    }

    return { gitAvailable, changed, changedFolders, changedStats };
  }

  async function treeGit(input: TreeGitInput): Promise<TreeGitOutput> {
    try {
      for (const path of input.paths) assertWorkspaceRelative(path);
      const environment = await bb.sdk.environments.get({ environmentId: input.environmentId });
      if (environment.path === null) return { gitAvailable: "unavailable", entries: [] };
    } catch {
      return { gitAvailable: "unavailable", entries: [] };
    }
    const { gitAvailable, changed, changedFolders, changedStats } = await readGit(input.environmentId);
    return {
      gitAvailable,
      entries: input.paths.map((path) => {
        const gitState = changed.get(path) ?? (changedFolders.has(path) ? "modified" : undefined);
        const candidate = changedStats.get(path);
        const stats = candidate && (candidate.additions > 0 || candidate.deletions > 0) ? candidate : undefined;
        return { path, ...(gitState === undefined ? {} : { gitState }), ...(stats ?? {}) };
      }),
    };
  }

  async function filePreview(input: FilePreviewInput): Promise<FilePreviewOutput> {
    try {
      assertWorkspaceRelative(input.path);
    } catch {
      return { outcome: "unavailable", reason: "invalid_path" };
    }
    let environment;
    try {
      environment = await bb.sdk.environments.get({ environmentId: input.environmentId });
    } catch {
      return { outcome: "unavailable", reason: "environment_unavailable" };
    }
    if (environment.path === null) return { outcome: "unavailable", reason: "no_workspace" };
    const hostPath = /^[a-z]:[\\/]|^\\\\/i.test(environment.path) ? win32 : posix;
    const rootPath = hostPath.normalize(environment.path);
    if (!hostPath.isAbsolute(rootPath)) return { outcome: "unavailable", reason: "no_workspace" };
    const path = hostPath.join(rootPath, ...input.path.split("/"));
    try {
      const read = await bb.sdk.files.read({ hostId: environment.hostId, rootPath, path });
      if (hostPath.normalize(read.path) !== path) return { outcome: "unavailable", reason: "file_unavailable" };
      if (read.sizeBytes > PREVIEW_MAX_BYTES || read.content.length > PREVIEW_MAX_BYTES) {
        return { outcome: "unavailable", reason: "too_large" };
      }
      if (read.contentEncoding !== "utf8" || read.content.includes("\0") ||
          (read.mimeType !== undefined && !/^(text\/|application\/(json|(?:[\w.-]+\+)?json|javascript|xml|(?:[\w.-]+\+)?xml|x-yaml)(?:;|$))/i.test(read.mimeType))) {
        return { outcome: "unavailable", reason: "unsupported" };
      }
      if (Buffer.byteLength(read.content, "utf8") > PREVIEW_MAX_BYTES) return { outcome: "unavailable", reason: "too_large" };
      return { outcome: "available", path: input.path, content: read.content };
    } catch {
      return { outcome: "unavailable", reason: "file_unavailable" };
    }
  }

  async function activitySnapshot(input: ActivitySnapshotInput): Promise<ActivitySnapshotOutput> {
    try {
      const timeline = await bb.sdk.threads.timeline({
        threadId: input.threadId,
        includeNestedRows: "true",
        summaryOnly: "false",
      });
      // Finished writes invalidate membership even if a fast tool's pending event was missed.
      return { available: true, activities: [...collectActiveActivities(timeline.rows), ...completedFileChanges(timeline.rows)] };
    } catch {
      return { available: false, activities: [] };
    }
  }

  async function listTree(input: ListTreeInput): Promise<ListTreeOutput> {
    let environment;
    try {
      environment = await bb.sdk.environments.get({ environmentId: input.environmentId });
    } catch {
      return { outcome: "unavailable", reason: "environment_unavailable" };
    }
    if (environment.path === null) {
      return { outcome: "unavailable", reason: "no_workspace" };
    }
    try {
      if (input.path !== "") assertWorkspaceRelative(input.path);
    } catch {
      return { outcome: "unavailable", directory: input.path, reason: "invalid_path" };
    }

    // The host can be remote and use a different path syntax from this process.
    const hostPath = /^[a-z]:[\\/]|^\\\\/i.test(environment.path) ? win32 : posix;
    const workspace = hostPath.normalize(environment.path);
    if (!hostPath.isAbsolute(workspace)) {
      return { outcome: "unavailable", reason: "no_workspace" };
    }
    const absoluteDirectory = input.path === "" ? workspace : hostPath.join(workspace, ...input.path.split("/"));

    let listed: ListedPath[];
    let truncated: boolean;
    try {
      const listing = await bb.sdk.hosts.directory({
        hostId: environment.hostId,
        path: absoluteDirectory,
      });
      if (hostPath.normalize(listing.directory) !== absoluteDirectory) {
        throw new Error("Unexpected directory");
      }
      listed = listing.entries.map((entry) => {
        // Accept only genuine direct children; never return host-absolute paths.
        const segments = assertWorkspaceRelative(entry.name);
        if (segments.length !== 1 || entry.path !== hostPath.join(absoluteDirectory, entry.name)) {
          throw new Error("Unexpected direct child");
        }
        return { path: input.path === "" ? entry.name : `${input.path}/${entry.name}`, kind: entry.kind };
      });
      listed = buildTree(listed);
      truncated = listed.length > 10_000;
      listed = listed.slice(0, 10_000);
    } catch {
      return { outcome: "unavailable", directory: input.path, reason: "directory_unavailable" };
    }

    const { gitAvailable, changed, changedFolders, changedStats } = await readGit(input.environmentId);

    return {
      outcome: "available",
      directory: input.path,
      entries: buildTree(listed.map((entry) => {
        const gitState = entry.kind === "directory"
          ? (changedFolders.has(entry.path) ? "modified" : undefined)
          : changed.get(entry.path);
        const candidate = changedStats.get(entry.path);
        const stats = candidate && (candidate.additions > 0 || candidate.deletions > 0) ? candidate : undefined;
        return { ...entry, ...(gitState === undefined ? {} : { gitState }), ...(stats ?? {}) };
      })),
      gitAvailable,
      truncated,
    };
  }

  async function activity(_input: { threadId: string }): Promise<ActivityOutput> {
    const snapshot = await activitySnapshot(_input);
    return {
      files: snapshot.activities.map((item) => ({
        threadId: _input.threadId,
        parentThreadId: null,
        path: item.path,
        kind: item.kind === "write" ? "write" as const : "read" as const,
        atMs: Date.now(),
        additions: 0,
        deletions: 0,
      })),
      status: [],
    };
  }

  async function log(message: string): Promise<null> {
    bb.log.info(message);
    return null;
  }

  return { listTree, activitySnapshot, filePreview, treeGit, workspace, tree, activity, prefsGet, prefsSet, stats, log };
}
