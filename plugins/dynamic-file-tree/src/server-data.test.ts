import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createFakePluginHost, experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { listTreeInputSchema } from "./contracts";
import { createServerData } from "./server-data";

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(disposals.splice(0).map((dispose) => dispose())); });
const gitFile = (path: string, changeKind = "modified", origin = "tracked") => ({
  path, previousPath: null, changeKind, origin, additions: 1, deletions: 0,
  binary: false, loadMode: "auto", revision: "rev_1",
});
const gitResult = {
  outcome: "available", files: [gitFile("src/app.ts"), gitFile("src-other/a.ts", "added"),
    gitFile(".gitignore", "added", "untracked"), gitFile("deleted.ts", "deleted")],
  truncated: false, shortstat: "", mergeBaseRef: null, initialPatches: [],
};
function setup(options: {
  workspace?: string | null; environmentError?: boolean; directoryError?: boolean;
  git?: unknown; gitError?: boolean; entries?: Array<{ name: string; path: string; kind: "file" | "directory" }>;
} = {}) {
  const host = createFakePluginHost({ sdk: {
    environments: { get: async () => {
      if (options.environmentError) throw new Error("offline");
      return { id: "env_1", hostId: "remote_host", path: options.workspace === undefined ? "/workspace/project" : options.workspace } as never;
    } },
    hosts: { directory: async ({ path }) => {
      if (options.directoryError) throw new Error("permission denied");
      return {
        directory: path!, parent: "/workspace", roots: ["/"],
        entries: options.entries ?? (path === "/workspace/project/src" ? [
          { name: "app.ts", path: "/workspace/project/src/app.ts", kind: "file" },
        ] : [
          { name: "src", path: "/workspace/project/src", kind: "directory" },
          { name: ".gitignore", path: "/workspace/project/.gitignore", kind: "file" },
          { name: "src-other", path: "/workspace/project/src-other", kind: "directory" },
          { name: "src-clean", path: "/workspace/project/src-clean", kind: "directory" },
        ]),
      };
    } },
    plugins: { callRpc: async () => {
      if (options.gitError) throw new Error("Git unavailable");
      return options.git ?? gitResult;
    } },
  } });
  disposals.push(() => host.harness.lifecycle.dispose());
  return { ...host, data: createServerData(host.bb) };
}

describe("direct environment directory data", () => {
  it("lists only root entries, including dotfiles, and annotates changed descendants", async () => {
    const { data, harness } = setup();
    expect(await data.listTree({ environmentId: "env_1", path: "" })).toEqual({
      outcome: "available", directory: "", gitAvailable: "available", truncated: false,
      entries: [
        { path: "src", name: "src", kind: "directory", gitState: "modified" },
        { path: "src-clean", name: "src-clean", kind: "directory" },
        { path: "src-other", name: "src-other", kind: "directory", gitState: "modified" },
        { path: ".gitignore", name: ".gitignore", kind: "file", gitState: "untracked" },
      ],
    });
    expect(harness.inspection.sdk.callsTo("hosts.directory")[0]?.[0]).toEqual({ hostId: "remote_host", path: "/workspace/project" });
    expect(harness.inspection.sdk.callsTo("files.listPaths")).toHaveLength(0);
    expect(harness.inspection.sdk.callsTo("plugins.callRpc")[0]?.[0]).toMatchObject({
      pluginId: "bb--git", method: "files", input: { environmentId: "env_1", target: { type: "uncommitted" }, ignoreWhitespace: false },
    });
  });

  it("returns nested entries with project-relative paths", async () => {
    const { data, harness } = setup();
    expect(await data.listTree({ environmentId: "env_1", path: "src" })).toEqual({
      outcome: "available", directory: "src", gitAvailable: "available", truncated: false,
      entries: [{ path: "src/app.ts", name: "app.ts", kind: "file", gitState: "modified" }],
    });
    expect(harness.inspection.sdk.callsTo("hosts.directory")[0]?.[0]).toEqual({ hostId: "remote_host", path: "/workspace/project/src" });
  });

  it("returns an empty directory as an available empty listing", async () => {
    const { data } = setup({ entries: [] });
    expect(await data.listTree({ environmentId: "env_1", path: "empty" })).toMatchObject({ outcome: "available", directory: "empty", entries: [], truncated: false });
  });

  it("preserves not_applicable for non-Git environments", async () => {
    const { data } = setup({ git: { outcome: "not_applicable", reason: "non_git_environment", message: "No Git" } });
    const result = await data.listTree({ environmentId: "env_1", path: "" });
    expect(result).toMatchObject({ outcome: "available", gitAvailable: "not_applicable" });
    if (result.outcome === "available") expect(result.entries.every((entry) => entry.gitState === undefined)).toBe(true);
  });

  it.each([false, true])("keeps filesystem data when Git is unavailable (throw=%s)", async (gitError) => {
    const { data } = setup({ gitError, git: { outcome: "unavailable", failure: { code: "offline", workspacePath: "/private", message: "offline" } } });
    expect(await data.listTree({ environmentId: "env_1", path: "" })).toMatchObject({ outcome: "available", gitAvailable: "unavailable", truncated: false });
  });

  it.each([
    { workspace: null, reason: "no_workspace" },
    { environmentError: true, reason: "environment_unavailable" },
  ])("returns explicit unavailable outcomes without host reads: $reason", async ({ reason, ...options }) => {
    const { data, harness } = setup(options);
    expect(await data.listTree({ environmentId: "env_1", path: "" })).toEqual({ outcome: "unavailable", reason });
    expect(harness.inspection.sdk.callsTo("hosts.directory")).toHaveLength(0);
  });

  it.each(["/absolute", "a/../b", "a//b", "a/./b", "a\\b", "C:/secret", "a\0b"])("rejects unsafe request %j before filesystem access", async (path) => {
    const { data, harness } = setup();
    expect(await data.listTree({ environmentId: "env_1", path })).toEqual({ outcome: "unavailable", directory: path, reason: "invalid_path" });
    expect(harness.inspection.sdk.callsTo("hosts.directory")).toHaveLength(0);
  });

  it("keeps host failures local to the requested directory", async () => {
    const { data } = setup({ directoryError: true });
    expect(await data.listTree({ environmentId: "env_1", path: "src" })).toEqual({ outcome: "unavailable", directory: "src", reason: "directory_unavailable" });
  });

  it.each(["/outside/secret", "/workspace/project/src/deep/file", "/workspace/project-other/a"])("rejects host entries outside the direct directory: %s", async (path) => {
    const { data } = setup({ entries: [{ name: "secret", kind: "file", path }] });
    expect(await data.listTree({ environmentId: "env_1", path: "" })).toEqual({ outcome: "unavailable", directory: "", reason: "directory_unavailable" });
  });

  it("caps only the requested listing and ignores Git truncation for filesystem completeness", async () => {
    const entries = Array.from({ length: 10_001 }, (_, i) => ({ name: `${i}.ts`, kind: "file" as const, path: `/workspace/project/${i}.ts` }));
    const { data } = setup({ entries });
    const result = await data.listTree({ environmentId: "env_1", path: "" });
    expect(result).toMatchObject({ outcome: "available", directory: "", truncated: true });
    if (result.outcome === "available") expect(result.entries).toHaveLength(10_000);
    const other = setup({ git: { ...gitResult, truncated: true } });
    expect(await other.data.listTree({ environmentId: "env_1", path: "src" })).toMatchObject({ directory: "src", truncated: false });
  });

  it("registers the new root default and preserves the activity snapshot", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    expect(listTreeInputSchema.parse({ environmentId: " env_1 ", includeHidden: false })).toEqual({ environmentId: "env_1", path: "" });
    expect(await harness.behavior.callRpc("tree_list", { environmentId: "env_1" })).toMatchObject({ outcome: "available", directory: "", gitAvailable: "available" });
    expect(await harness.behavior.callRpc("activity_snapshot", { threadId: "thread_1" })).toEqual({ available: false, activities: [] });
  });
});

it("uses only public SDK and declared package imports", () => {
  const scan = experimental_scanPublicSdkOnly(fileURLToPath(new URL("../", import.meta.url)), {
    allow: [/^react(?:\/|$)/, /^@testing-library\//, /^vitest$/],
  });
  expect(scan.violations).toEqual([]);
  expect(scan.privateDependencies).toEqual([]);
});
