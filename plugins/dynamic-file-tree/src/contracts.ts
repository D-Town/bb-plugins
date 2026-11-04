import { z } from "zod";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import type { GitState, TreeEntry } from "./tree-model";

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
    children: z.array(treeEntrySchema).optional(),
    gitState: gitStateSchema.optional(),
  }),
);

export const listTreeInputSchema = z.object({
  environmentId: z.string().trim().min(1),
  includeHidden: z.boolean().default(false),
});

export const listTreeOutputSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("available"),
    entries: z.array(treeEntrySchema).max(10_000),
    truncated: z.boolean(),
  }),
  z.object({
    outcome: z.literal("unavailable"),
    reason: z.enum(["no_workspace", "environment_unavailable"]),
  }),
]);

export const rpcContract = defineRpcContract({
  tree_list: {
    input: listTreeInputSchema,
    output: listTreeOutputSchema,
  },
});

export type ListTreeInput = z.infer<typeof listTreeInputSchema>;
export type ListTreeOutput = z.infer<typeof listTreeOutputSchema>;
export type { GitState, TreeEntry };
