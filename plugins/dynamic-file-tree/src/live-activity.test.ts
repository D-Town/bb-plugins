import { describe, expect, it } from "vitest";
import { countDiff, createLiveActivityCollector } from "./live-activity";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";

describe("live file activity", () => {
  it("counts diff lines without counting unified-diff headers", () => {
    expect(countDiff("--- a/app.ts\n+++ b/app.ts\n-old\n+new\n+another\n context")).toEqual({ additions: 2, deletions: 1 });
  });

  it("turns file read/change events into activity and status snapshots", async () => {
    const host = createFakePluginHost({ sdk: {
      threads: { events: { list: async () => [
        { seq: 1, data: { item: { type: "fileRead", path: "src/app.ts" } } },
        { seq: 2, data: { item: { type: "fileChange", changes: [
          { path: "src/new.ts", kind: "add", diff: "+++ b/src/new.ts\n+one\n+two" },
          { path: "src/old.ts", kind: "delete", diff: "--- a/src/old.ts\n-old" },
        ] } } },
      ] } },
    } });
    const collector = createLiveActivityCollector(host.bb);
    const result = await collector.sync({ id: "thread_1", parentThreadId: null });

    expect(result.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "src/app.ts", kind: "read", additions: 0, deletions: 0 }),
      expect.objectContaining({ path: "src/new.ts", kind: "write", additions: 2, deletions: 0 }),
      expect.objectContaining({ path: "src/old.ts", kind: "write", additions: 0, deletions: 1 }),
    ]));
    expect(result.status).toEqual(expect.arrayContaining([
      { path: "src/new.ts", addedAt: expect.any(Number), deletedAt: null },
      { path: "src/old.ts", addedAt: null, deletedAt: expect.any(Number) },
    ]));
    await host.harness.lifecycle.dispose();
  });

  it("recovers Codex shell reads and apply_patch writes", async () => {
    const host = createFakePluginHost({ sdk: {
      environments: { get: async () => ({ path: "/workspace/project" }) },
      threads: { events: { list: async () => [
        { seq: 3, data: { item: { type: "commandExecution", cwd: "/workspace/project", command: "/bin/zsh -lc \"sed -n '1,80p' README.md\"" } } },
        { seq: 4, data: { item: { type: "commandExecution", cwd: "/workspace/project", command: "apply_patch <<'PATCH'\n*** Update File: /workspace/project/plugins/dynamic-file-tree/src/components/FileTreeSection.tsx\nPATCH" } } },
      ] } },
    } });
    const result = await createLiveActivityCollector(host.bb).sync({ id: "thread_1", parentThreadId: null, environmentId: "env_1" });
    expect(result.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "README.md", kind: "read" }),
      expect.objectContaining({ path: "plugins/dynamic-file-tree/src/components/FileTreeSection.tsx", kind: "write" }),
    ]));
    await host.harness.lifecycle.dispose();
  });
});
