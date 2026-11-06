import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createFakePluginHost, experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { listTreeInputSchema, rpcContract } from "./contracts";
import { createServerData } from "./server-data";

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(disposals.splice(0).map((dispose) => dispose())); });
const gitFile = (path: string, changeKind = "modified", origin = "tracked", additions = 0, deletions = 0) => ({
  path, previousPath: null, changeKind, origin, additions, deletions,
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
  hiddenEntries?: Array<{ name: string; path: string; kind: "file" | "directory" }>;
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
    files: { listPaths: async ({ path }) => ({
      paths: (options.hiddenEntries ?? []).filter((entry) => entry.path.startsWith(`${path}/`)).map((entry) => ({
        ...entry, path: entry.path.slice(`${path}/`.length),
      })),
      truncated: false,
    }) },
    plugins: { callRpc: async () => {
      if (options.gitError) throw new Error("Git unavailable");
      return options.git ?? gitResult;
    } },
  } });
  disposals.push(() => host.harness.lifecycle.dispose());
  return { ...host, data: createServerData(host.bb) };
}

describe("direct environment directory data", () => {
  it("includes hidden directories from the path listing", async () => {
    const { data } = setup({ entries: [], hiddenEntries: [
      { name: ".github", path: "/workspace/project/.github", kind: "directory" },
      { name: "workflows", path: "/workspace/project/.github/workflows", kind: "directory" },
    ] });
    const result = await data.listTree({ environmentId: "env_1", path: "" });
    expect(result).toMatchObject({ outcome: "available", entries: [
      { path: ".github", name: ".github", kind: "directory" },
    ] });
  });

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
    expect(harness.inspection.sdk.callsTo("files.listPaths")[0]?.[0]).toMatchObject({
      hostId: "remote_host", path: "/workspace/project", includeHidden: true,
      includeFiles: true, includeDirectories: true,
    });
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

  it("attaches Git line stats to files and aggregates them on folders", async () => {
    const { data } = setup({ git: {
      ...gitResult,
      files: [gitFile("src/app.ts", "modified", "tracked", 12, 4)],
    } });
    const root = await data.listTree({ environmentId: "env_1", path: "" });
    const nested = await data.listTree({ environmentId: "env_1", path: "src" });
    expect(root.outcome === "available" && root.entries.find((entry) => entry.path === "src")).toMatchObject({ additions: 12, deletions: 4 });
    expect(nested.outcome === "available" && nested.entries.find((entry) => entry.path === "src/app.ts")).toMatchObject({ additions: 12, deletions: 4 });
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

  it("merges stored preferences with defaults and validates updates", async () => {
    const { data } = setup();
    expect(await data.prefsGet()).toEqual({ locale: "auto", showDiff: true, showSize: false, showMtime: false, showFullPath: false, useNerdFontIcons: false, autoCollapse: true, readColor: "#8b5cf6", writeColor: "#f59e0b", addedColor: "#22c55e", deletedColor: "#ef4444", modifiedColor: "#ad7900", diffAddColor: "#38854b", diffDeleteColor: "#cf4545" });
    await data.prefsSet({ locale: "en", showDiff: false, showSize: true, showMtime: true, showFullPath: true, useNerdFontIcons: true, autoCollapse: false, readColor: "#112233", writeColor: "#223344", addedColor: "#334455", deletedColor: "#445566", modifiedColor: "#556677", diffAddColor: "#667788", diffDeleteColor: "#778899" });
    expect(await data.prefsGet()).toMatchObject({ showDiff: false, showSize: true, autoCollapse: false });
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

describe("bounded fallback preview", () => {
  it("exposes completed file changes for invalidation even when the pending row was missed", async () => {
    const { bb, harness } = setup();
    harness.sdk.stub("threads.timeline", async () => ({ rows: [{
      id: "turn", kind: "turn", status: "completed", children: [
        { id: "write_1", kind: "work", workKind: "file-change", status: "completed", change: { path: "src/new.ts" } },
        { id: "unsafe", kind: "work", workKind: "file-change", status: "completed", change: { path: "../secret" } },
      ],
    }] } as never));
    await plugin(bb);
    expect(await harness.behavior.callRpc("activity_snapshot", { threadId: "thread_1" })).toEqual({
      available: true, activities: [{ activityId: "write_1", path: "src/new.ts", kind: "write", status: "completed" }],
    });
  });

  it.each([
    { workspace: null, reason: "no_workspace" },
    { environmentError: true, reason: "environment_unavailable" },
  ])("does not read fallback files without a workspace: $reason", async ({ reason, ...options }) => {
    const { bb, harness } = setup(options);
    await plugin(bb);
    expect(await harness.behavior.callRpc("file_preview", { environmentId: "env_1", path: "app.ts" })).toEqual({ outcome: "unavailable", reason });
    expect(harness.inspection.sdk.callsTo("files.read")).toHaveLength(0);
  });

  it("uses the remote Windows workspace syntax for fallback reads", async () => {
    const { bb, harness } = setup({ workspace: "C:\\repo" });
    harness.sdk.stub("files.read", async () => ({ path: "C:\\repo\\src\\app.ts", content: "test", contentEncoding: "utf8", sizeBytes: 4, sha256: "sha" }));
    await plugin(bb);
    expect(await harness.behavior.callRpc("file_preview", { environmentId: "env_1", path: "src/app.ts" })).toEqual({ outcome: "available", path: "src/app.ts", content: "test" });
    expect(harness.inspection.sdk.callsTo("files.read")[0]?.[0]).toEqual({ hostId: "remote_host", rootPath: "C:\\repo", path: "C:\\repo\\src\\app.ts" });
  });

  it("reads through the selected remote environment with explicit containment and returns text", async () => {
    const { bb, harness } = setup();
    harness.sdk.stub("files.read", async () => ({ path: "/workspace/project/.gitignore", content: "node_modules/", contentEncoding: "utf8", sizeBytes: 13, sha256: "sha" }));
    await plugin(bb);
    expect(await harness.behavior.callRpc("file_preview", { environmentId: "env_1", path: ".gitignore" })).toEqual({ outcome: "available", path: ".gitignore", content: "node_modules/" });
    expect(harness.inspection.sdk.callsTo("files.read")[0]?.[0]).toEqual({ hostId: "remote_host", rootPath: "/workspace/project", path: "/workspace/project/.gitignore" });
  });

  it.each([
    { content: "A".repeat(65_537), contentEncoding: "utf8", sizeBytes: 65_537, reason: "too_large" },
    { content: "é".repeat(40_000), contentEncoding: "utf8", sizeBytes: 1, reason: "too_large" },
    { content: "AA==", contentEncoding: "base64", sizeBytes: 1, reason: "unsupported" },
    { content: "a\0b", contentEncoding: "utf8", sizeBytes: 3, reason: "unsupported" },
    { content: "<svg/>", contentEncoding: "utf8", sizeBytes: 6, mimeType: "image/svg+xml", reason: "unsupported" },
  ])("returns $reason without transporting unsupported or oversized content", async ({ reason, ...read }) => {
    const { bb, harness } = setup();
    harness.sdk.stub("files.read", async () => ({ ...read, contentEncoding: read.contentEncoding as "utf8" | "base64", path: "/workspace/project/file", sha256: "sha" }));
    await plugin(bb);
    expect(await harness.behavior.callRpc("file_preview", { environmentId: "env_1", path: "file" })).toEqual({ outcome: "unavailable", reason });
  });

  it.each(["../secret", "/absolute", "a\\b", "a/../secret"])("rejects %j without reading any file", async (path) => {
    const { bb, harness } = setup();
    await plugin(bb);
    expect(await harness.behavior.callRpc("file_preview", { environmentId: "env_1", path })).toEqual({ outcome: "unavailable", reason: "invalid_path" });
    expect(harness.inspection.sdk.callsTo("files.read")).toHaveLength(0);
  });

  it("bounds preview RPC input/output and refuses unknown fields", () => {
    expect(rpcContract.file_preview.input.safeParse({ environmentId: "env_1", path: "file", rootPath: "/elsewhere" }).success).toBe(false);
    expect(rpcContract.file_preview.output.safeParse({ outcome: "available", path: "file", content: "a".repeat(65_537) }).success).toBe(false);
  });
});

describe("Git annotation refresh", () => {
  it("refreshes requested cached paths without listing directories", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    expect(await harness.behavior.callRpc("tree_git", { environmentId: "env_1", paths: ["src", "src/app.ts", ".gitignore", "clean.md"] })).toEqual({
      gitAvailable: "available", entries: [
        { path: "src", gitState: "modified" }, { path: "src/app.ts", gitState: "modified" },
        { path: ".gitignore", gitState: "untracked" }, { path: "clean.md" },
      ],
    });
    expect(harness.inspection.sdk.callsTo("hosts.directory")).toHaveLength(0);
    expect(harness.inspection.sdk.callsTo("plugins.callRpc")[0]?.[0]).toMatchObject({ input: { environmentId: "env_1" } });
  });

  it("returns Git line stats for targeted annotation refreshes", async () => {
    const { bb, harness } = setup({ git: {
      ...gitResult,
      files: [gitFile("src/app.ts", "modified", "tracked", 12, 4)],
    } });
    await plugin(bb);
    expect(await harness.behavior.callRpc("tree_git", { environmentId: "env_1", paths: ["src", "src/app.ts"] })).toEqual({
      gitAvailable: "available", entries: [
        { path: "src", gitState: "modified", additions: 12, deletions: 4 },
        { path: "src/app.ts", gitState: "modified", additions: 12, deletions: 4 },
      ],
    });
  });
});
