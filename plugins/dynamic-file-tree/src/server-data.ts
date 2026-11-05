import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { posix, win32 } from "node:path";
import { assertWorkspaceRelative, buildTree, type ListedPath, type GitState } from "./tree-model";
import type { ActivitySnapshotInput, ActivitySnapshotOutput, ListTreeInput, ListTreeOutput } from "./contracts";
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

export function createServerData(bb: BbPluginApi) {
  async function activitySnapshot(input: ActivitySnapshotInput): Promise<ActivitySnapshotOutput> {
    try {
      const timeline = await bb.sdk.threads.timeline({
        threadId: input.threadId,
        includeNestedRows: "true",
        summaryOnly: "false",
      });
      return { available: true, activities: collectActiveActivities(timeline.rows) };
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

    // Git is optional annotation data. Its failure must not hide the directory.
    let gitAvailable: "available" | "not_applicable" | "unavailable" = "unavailable";
    const changed = new Map<string, GitState>();
    const changedFolders = new Set<string>();
    try {
      const git = await bb.sdk.plugins.callRpc({
        pluginId: "bb--git",
        method: "files",
        input: {
          environmentId: input.environmentId,
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
            for (let i = 1; i < segments.length; i++) {
              changedFolders.add(segments.slice(0, i).join("/"));
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

    return {
      outcome: "available",
      directory: input.path,
      entries: buildTree(listed.map((entry) => {
        const gitState = entry.kind === "directory"
          ? (changedFolders.has(entry.path) ? "modified" : undefined)
          : changed.get(entry.path);
        return { ...entry, ...(gitState === undefined ? {} : { gitState }) };
      })),
      gitAvailable,
      truncated,
    };
  }

  return { listTree, activitySnapshot };
}
