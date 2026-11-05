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

export const rpcContract = defineRpcContract({
  activity_snapshot: {
    input: activitySnapshotInputSchema,
    output: activitySnapshotOutputSchema,
  },
  tree_list: {
    input: listTreeInputSchema,
    output: listTreeOutputSchema,
  },
});

export type ListTreeInput = z.infer<typeof listTreeInputSchema>;
export type ListTreeOutput = z.infer<typeof listTreeOutputSchema>;
export type ActivePathActivity = z.infer<typeof activePathActivitySchema>;
export type ActivitySnapshotInput = z.infer<typeof activitySnapshotInputSchema>;
export type ActivitySnapshotOutput = z.infer<typeof activitySnapshotOutputSchema>;
export type ActivityUpdated = z.infer<typeof activityUpdatedSchema>;
export type { GitState, TreeEntry };
