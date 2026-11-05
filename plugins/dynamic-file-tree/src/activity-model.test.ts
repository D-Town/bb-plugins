import { describe, expect, it } from "vitest";
import { collectActiveActivities, ancestorPaths, activeAncestorPaths } from "./activity-model";

const work = (id: string, workKind: string, fields: Record<string, unknown> = {}) => ({
  id, kind: "work", workKind, status: "pending", threadId: "thread_1", turnId: "turn_1",
  callId: id, createdAt: 1, startedAt: 1, completedAt: null, sourceSeqStart: 1, sourceSeqEnd: 1,
  ...fields,
});

describe("timeline path activity", () => {
  it("collects concurrent reads and changes from recursively nested turn children", () => {
    expect(collectActiveActivities([{ kind: "turn", status: "pending", children: [
      work("read_1", "file-read", { path: "src/app.ts", cmd: null }),
      { kind: "turn", status: "pending", children: [work("write_1", "file-change", {
        change: { path: "src/new.ts", movePath: null, kind: "add", diff: null, diffStats: { added: 1, removed: 0 } },
      })] },
      work("read_2", "file-read", { path: "src/app.ts", cmd: null }),
    ] }])).toEqual([
      { activityId: "read_1", path: "src/app.ts", kind: "read", status: "pending" },
      { activityId: "write_1", path: "src/new.ts", kind: "write", status: "pending" },
      { activityId: "read_2", path: "src/app.ts", kind: "read", status: "pending" },
    ]);
  });

  it("collects known-path searches and list searches", () => {
    expect(collectActiveActivities([
      work("search", "search", { mode: "content", path: "src", cmd: "rg needle src" }),
      work("list", "search", { mode: "list", path: "tests", cmd: "rg --files tests" }),
      work("unknown", "search", { mode: "path", path: null, cmd: "rg --files" }),
    ])).toEqual([
      { activityId: "search", path: "src", kind: "search", status: "pending" },
      { activityId: "list", path: "tests", kind: "list", status: "pending" },
    ]);
  });

  it("uses explicit command intents without guessing paths from shell text", () => {
    expect(collectActiveActivities([work("cmd", "command", { command: "cat secret; ls; rg needle", activityIntents: [
      { type: "read", path: "src/a.ts", name: "a.ts", command: "cat src/a.ts" },
      { type: "list_files", path: "docs", command: "ls docs" },
      { type: "search", path: "tests", query: "needle", command: "rg needle tests" },
      { type: "read", path: null, name: "secret", command: "cat secret" },
      { type: "unknown", command: "cat secret" },
      { type: "write", path: "secret", command: "touch secret" },
    ] })])).toEqual([
      { activityId: "cmd", path: "src/a.ts", kind: "read", status: "pending" },
      { activityId: "cmd", path: "docs", kind: "list", status: "pending" },
      { activityId: "cmd", path: "tests", kind: "search", status: "pending" },
    ]);
  });

  it.each(["completed", "error", "interrupted"])("clears %s work and stale pending children of terminal turns", (status) => {
    expect(collectActiveActivities([
      work("done", "file-read", { path: "src/a.ts", status }),
      { kind: "turn", status, children: [work("stale", "file-read", { path: "src/b.ts" })] },
    ])).toEqual([]);
  });

  it.each(["/etc/passwd", "../secret", "src/../secret", "src/./a", "src//a", "C:/secret", "C:secret", "\\\\host\\secret", "src\\a", "a\0b", "", " "])("rejects unsafe paths %j from every recognized source", (path) => {
    expect(collectActiveActivities([
      work("r", "file-read", { path }), work("w", "file-change", { change: { path } }),
      work("s", "search", { path, mode: "content" }),
      work("c", "command", { activityIntents: [{ type: "read", path }] }),
    ])).toEqual([]);
    expect(ancestorPaths(path)).toEqual([]);
  });

  it("ignores malformed and unrelated rows without traversing arbitrary tool data", () => {
    expect(collectActiveActivities([null, 1, {}, { kind: "turn", children: null },
      work("", "file-read", { path: "src/a.ts" }),
      work("bad", "file-read", { path: 1 }),
      work("status", "file-read", { path: "src/a.ts", status: null }),
      work("tool", "tool", { path: "src/a.ts", children: [work("fake", "file-read", { path: "secret" })] }),
    ])).toEqual([]);
  });
});

it("derives strict ancestors and deduplicates pending activity ancestors", () => {
  expect(ancestorPaths("src/components/Button.tsx")).toEqual(["src", "src/components"]);
  expect(ancestorPaths("README.md")).toEqual([]);
  expect(activeAncestorPaths([
    { activityId: "a", path: "src/components/Button.tsx", kind: "read", status: "pending" },
    { activityId: "b", path: "src/utils.ts", kind: "write", status: "pending" },
    { activityId: "c", path: "docs/readme.md", kind: "read", status: "completed" },
    { activityId: "d", path: "errors/a.ts", kind: "read", status: "error" },
    { activityId: "e", path: "interrupted/a.ts", kind: "read", status: "interrupted" },
  ])).toEqual(["src", "src/components"]);
});
