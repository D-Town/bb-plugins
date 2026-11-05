import { afterEach, describe, expect, it } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";

// Derive fixtures from the public timeline API, including all response fields.
type Timeline = Extract<Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["timeline"]>>, { rows: unknown }>;
function timeline(threadId: string, status: "pending" | "completed" = "pending"): Timeline {
  const base = { createdAt: 1, startedAt: 1, sourceSeqStart: 1, sourceSeqEnd: 2, threadId, turnId: "turn_1" };
  return {
    activeBackgroundCommands: [], activePromptMode: null, activeThinking: null, activeWorkflows: [],
    completedTurnDisplay: "collapse", contextBoundarySeq: null, goal: null, maxSeq: 2, modelFallback: null,
    pendingTodos: null, providerCommands: null, sessionOptions: null, tag: "snapshot_2",
    timelinePage: { historySnapshot: "snapshot_2", olderCursor: null, olderRowsSourceSeqEnd: null, returnedSegmentCount: 1 },
    rows: [{ ...base, id: "turn_1", kind: "turn", status, completedAt: status === "pending" ? null : 2, summaryCount: 1,
      children: [{ ...base, id: `read_${threadId}`, kind: "work", workKind: "file-read", status,
        completedAt: status === "pending" ? null : 2, callId: "call_1", path: "src/app.ts", cmd: null }],
    }],
  };
}

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(disposals.splice(0).map((dispose) => dispose())); });
function setup() {
  let fail = false;
  let status: "pending" | "completed" = "pending";
  const host = createFakePluginHost({ sdk: { threads: { timeline: async ({ threadId }) => {
    if (fail) throw new Error("timeline offline");
    return timeline(threadId, status);
  } } } });
  disposals.push(() => host.harness.lifecycle.dispose());
  return { ...host, fail: () => { fail = true; }, complete: () => { status = "completed"; } };
}

describe("activity snapshot and realtime bridge", () => {
  it("normalizes a nested full timeline through the snapshot RPC", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    expect(await harness.behavior.callRpc("activity_snapshot", { threadId: "thread_1" })).toEqual({
      available: true, activities: [{ activityId: "read_thread_1", path: "src/app.ts", kind: "read", status: "pending" }],
    });
    expect(harness.inspection.sdk.callsTo("threads.timeline")[0]?.[0]).toEqual({
      threadId: "thread_1", includeNestedRows: "true", summaryOnly: "false",
    });
  });

  it("returns unavailable instead of throwing when timeline fails", async () => {
    const { bb, harness, fail } = setup();
    await plugin(bb);
    fail();
    expect(await harness.behavior.callRpc("activity_snapshot", { threadId: "thread_1" })).toEqual({ available: false, activities: [] });
    expect(harness.inspection.sdk.callsTo("threads.timeline")).toHaveLength(1);
  });

  it("distinguishes an available empty snapshot after completion", async () => {
    const { bb, harness, complete } = setup();
    await plugin(bb);
    complete();
    expect(await harness.behavior.callRpc("activity_snapshot", { threadId: "thread_1" })).toEqual({ available: true, activities: [] });
  });

  it("publishes thread-specific snapshots and sequence numbers for client filtering", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    for (const [id, sequence] of [["thread_1", 10], ["thread_2", 20]] as const) {
      expect(await harness.behavior.emitThreadEvent("experimental_thread.events", { thread: makeThreadResponse({ id }), sequence })).toEqual({ errors: [] });
    }
    expect(harness.inspection.realtimeSignals).toEqual([
      { channel: "activity-updated", payload: { threadId: "thread_1", sequence: 10, available: true,
        activities: [{ activityId: "read_thread_1", path: "src/app.ts", kind: "read", status: "pending" }] } },
      { channel: "activity-updated", payload: { threadId: "thread_2", sequence: 20, available: true,
        activities: [{ activityId: "read_thread_2", path: "src/app.ts", kind: "read", status: "pending" }] } },
    ]);
  });

  it("publishes empty cleanup and unavailable fallback instead of leaving stale activity", async () => {
    const { bb, harness, complete, fail } = setup();
    await plugin(bb);
    const thread = makeThreadResponse({ id: "thread_1" });
    await harness.behavior.emitThreadEvent("experimental_thread.events", { thread, sequence: 1 });
    complete();
    await harness.behavior.emitThreadEvent("experimental_thread.events", { thread, sequence: 2 });
    fail();
    expect(await harness.behavior.emitThreadEvent("experimental_thread.events", { thread, sequence: 3 })).toEqual({ errors: [] });
    expect(harness.inspection.realtimeSignals.slice(1)).toEqual([
      { channel: "activity-updated", payload: { threadId: "thread_1", sequence: 2, available: true, activities: [] } },
      { channel: "activity-updated", payload: { threadId: "thread_1", sequence: 3, available: false, activities: [] } },
    ]);
  });
});
