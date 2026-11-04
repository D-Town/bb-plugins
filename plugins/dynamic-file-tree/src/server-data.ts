import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { buildTree, type ListedPath, type GitState } from "./tree-model";
import type { ListTreeInput, ListTreeOutput } from "./contracts";
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
  async function listTree(input: ListTreeInput): Promise<ListTreeOutput> {
    const environment = await bb.sdk.environments.get({ environmentId: input.environmentId });
    if (environment.path === null) {
      return { outcome: "unavailable", reason: "no_workspace" };
    }

    const [paths, git] = await Promise.all([
      bb.sdk.files.listPaths({
        hostId: environment.hostId,
        path: environment.path,
        includeFiles: true,
        includeDirectories: true,
        includeHidden: input.includeHidden,
        limit: 10_000,
      }),
      bb.sdk.plugins.callRpc({
        pluginId: "bb--git",
        method: "files",
        input: {
          environmentId: input.environmentId,
          target: { type: "uncommitted" },
          ignoreWhitespace: false,
        },
        outputSchema: gitFilesOutputSchema,
      }),
    ]);

    const changed = new Map<string, GitState>();
    if (git.outcome === "available") {
      for (const file of git.files) {
        changed.set(file.path, mapGitState(file.changeKind, file.origin));
      }
    }

    const listed: ListedPath[] = paths.paths.map((entry) => ({
      path: entry.path,
      kind: entry.kind,
      gitState: changed.get(entry.path),
    }));

    return {
      outcome: "available",
      entries: buildTree(listed),
      truncated: paths.truncated,
    };
  }

  return { listTree };
}
