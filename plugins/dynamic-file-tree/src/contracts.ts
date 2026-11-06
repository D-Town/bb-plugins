import { z } from "zod";
import type { GitState, TreeEntry } from "./tree-model";
import type { PluginTimelineRowStatus } from "@get-bb/plugin-sdk";

const activityStatusSchema: z.ZodType<PluginTimelineRowStatus> = z.enum([
  "completed",
  "error",
  "interrupted",
  "pending",
]);

export const activePathActivitySchema = z.object({
  activityId: z.string().min(1),
  path: z.string().min(1),
  kind: z.enum(["read", "write", "search", "list"]),
  status: activityStatusSchema,
});

export const activitySnapshotInputSchema = z.object({
  threadId: z.string().trim().min(1),
});

export const activitySnapshotOutputSchema = z.object({
  available: z.boolean(),
  activities: z.array(activePathActivitySchema),
});

export const activityUpdatedSchema = activitySnapshotOutputSchema.extend({
  threadId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
});

export const liveActivityFileSchema = z.strictObject({
  threadId: z.string().min(1),
  parentThreadId: z.string().nullable(),
  path: z.string().min(1).max(4096),
  kind: z.enum(["read", "write"]),
  atMs: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});
export const liveActivityStatusSchema = z.strictObject({
  path: z.string().min(1).max(4096),
  addedAt: z.number().int().nonnegative().nullable(),
  deletedAt: z.number().int().nonnegative().nullable(),
});
export const liveActivityOutputSchema = z.strictObject({
  threadId: z.string().min(1),
  parentThreadId: z.string().nullable(),
  files: z.array(liveActivityFileSchema).max(10_000),
  status: z.array(liveActivityStatusSchema).max(10_000),
});
export const workspaceInputSchema = z.strictObject({ threadId: z.string().trim().min(1), environmentId: z.string().trim().min(1) });
export const workspaceOutputSchema = z.strictObject({ rootPath: z.string(), hostId: z.string(), branchName: z.string().nullable(), isGitRepo: z.boolean() });
export const treeInputSchema = z.strictObject({ rootPath: z.string().max(4096), hostId: z.string().min(1) });
export const treeOutputSchema = z.strictObject({
  entries: z.array(z.strictObject({ path: z.string().min(1).max(4096), kind: z.enum(["directory", "file"]) })).max(10_000),
  truncated: z.boolean(),
});
export const activityInputSchema = z.strictObject({ threadId: z.string().trim().min(1) });
export const activityOutputSchema = z.strictObject({ files: z.array(liveActivityFileSchema).max(10_000), status: z.array(liveActivityStatusSchema).max(10_000) });
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected a six-digit hex color");
const localePreferenceSchema = z.enum(["auto", "en", "de"]);
export const prefsSchema = z.strictObject({
  locale: localePreferenceSchema,
  showDiff: z.boolean(), showSize: z.boolean(), showMtime: z.boolean(), showFullPath: z.boolean(), useNerdFontIcons: z.boolean(), autoCollapse: z.boolean(),
  readColor: colorSchema,
  writeColor: colorSchema,
  addedColor: colorSchema,
  deletedColor: colorSchema,
  modifiedColor: colorSchema,
  diffAddColor: colorSchema,
  diffDeleteColor: colorSchema,
});
export const statsInputSchema = z.strictObject({ rootPath: z.string().max(4096), paths: z.array(z.string().min(1).max(4096)).max(500) });
export const statsOutputSchema = z.strictObject({ entries: z.array(z.strictObject({ path: z.string(), size: z.number().int().nonnegative().nullable(), mtimeMs: z.number().nonnegative().nullable() })).max(500) });
export const logInputSchema = z.strictObject({ message: z.string().max(2048) });

const gitStateSchema = z.enum([
  "clean",
  "modified",
  "added",
  "deleted",
  "renamed",
  "untracked",
]);

const treeEntrySchema: z.ZodType<TreeEntry> = z.lazy(() =>
  z.object({
    path: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(["file", "directory"]),
    hasChildren: z.boolean().optional(),
    children: z.array(treeEntrySchema).optional(),
    gitState: gitStateSchema.optional(),
    additions: z.number().int().nonnegative().optional(),
    deletions: z.number().int().nonnegative().optional(),
  }),
);

export const listTreeInputSchema = z.object({
  environmentId: z.string().trim().min(1),
  path: z.string().default(""),
});

export const listTreeOutputSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("available"),
    directory: z.string(),
    entries: z.array(treeEntrySchema).max(10_000),
    gitAvailable: z.enum(["available", "not_applicable", "unavailable"]),
    truncated: z.boolean(),
  }),
  z.object({
    outcome: z.literal("unavailable"),
    directory: z.string().optional(),
    reason: z.enum(["no_workspace", "environment_unavailable", "invalid_path", "directory_unavailable"]),
  }),
]);

export const PREVIEW_MAX_BYTES = 65_536;
const boundedPath = z.string().min(1).max(4096);
export const filePreviewInputSchema = z.strictObject({
  environmentId: z.string().trim().min(1).max(256),
  path: boundedPath,
});
export const filePreviewOutputSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("available"),
    path: boundedPath,
    content: z.string().max(PREVIEW_MAX_BYTES).refine((value) => new TextEncoder().encode(value).length <= PREVIEW_MAX_BYTES),
  }),
  z.strictObject({
    outcome: z.literal("unavailable"),
    reason: z.enum(["unsupported", "too_large", "invalid_path", "no_workspace", "environment_unavailable", "file_unavailable"]),
  }),
]);

export const treeGitInputSchema = z.strictObject({
  environmentId: z.string().trim().min(1).max(256),
  paths: z.array(boundedPath).max(10_000),
});
export const treeGitOutputSchema = z.strictObject({
  gitAvailable: z.enum(["available", "not_applicable", "unavailable"]),
  entries: z.array(z.strictObject({
    path: boundedPath,
    gitState: gitStateSchema.optional(),
    additions: z.number().int().nonnegative().optional(),
    deletions: z.number().int().nonnegative().optional(),
  })).max(10_000),
});

export const rpcContract = {
  activity_snapshot: {
    input: activitySnapshotInputSchema,
    output: activitySnapshotOutputSchema,
  },
  tree_list: {
    input: listTreeInputSchema,
    output: listTreeOutputSchema,
  },
  file_preview: { input: filePreviewInputSchema, output: filePreviewOutputSchema },
  tree_git: { input: treeGitInputSchema, output: treeGitOutputSchema },
  workspace: { input: workspaceInputSchema, output: workspaceOutputSchema },
  tree: { input: treeInputSchema, output: treeOutputSchema },
  activity: { input: activityInputSchema, output: activityOutputSchema },
  prefs_get: { input: z.strictObject({}), output: prefsSchema },
  prefs_set: { input: prefsSchema, output: prefsSchema },
  stats: { input: statsInputSchema, output: statsOutputSchema },
  log: { input: logInputSchema, output: z.null() },
};

export type FilePreviewInput = z.infer<typeof filePreviewInputSchema>;
export type FilePreviewOutput = z.infer<typeof filePreviewOutputSchema>;
export type TreeGitInput = z.infer<typeof treeGitInputSchema>;
export type TreeGitOutput = z.infer<typeof treeGitOutputSchema>;

export type ListTreeInput = z.infer<typeof listTreeInputSchema>;
export type ListTreeOutput = z.infer<typeof listTreeOutputSchema>;
export type ActivePathActivity = z.infer<typeof activePathActivitySchema>;
export type ActivitySnapshotInput = z.infer<typeof activitySnapshotInputSchema>;
export type ActivitySnapshotOutput = z.infer<typeof activitySnapshotOutputSchema>;
export type ActivityUpdated = z.infer<typeof activityUpdatedSchema>;
export type LiveActivityFile = z.infer<typeof liveActivityFileSchema>;
export type LiveActivityStatus = z.infer<typeof liveActivityStatusSchema>;
export type LiveActivityOutput = z.infer<typeof liveActivityOutputSchema>;
export type Prefs = z.infer<typeof prefsSchema>;
export type WorkspaceOutput = z.infer<typeof workspaceOutputSchema>;
export type TreeOutput = z.infer<typeof treeOutputSchema>;
export type ActivityOutput = z.infer<typeof activityOutputSchema>;
export type { GitState, TreeEntry };
