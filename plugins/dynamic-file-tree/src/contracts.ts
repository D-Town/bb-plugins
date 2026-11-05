import { z } from "zod";
import { defineRpcContract } from "@get-bb/plugin-sdk";
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
  entries: z.array(z.strictObject({ path: boundedPath, gitState: gitStateSchema.optional() })).max(10_000),
});

export const rpcContract = defineRpcContract({
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
});

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
export type { GitState, TreeEntry };
