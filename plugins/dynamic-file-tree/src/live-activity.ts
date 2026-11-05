import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { LiveActivityFile, LiveActivityOutput, LiveActivityStatus } from "./contracts";
import { assertWorkspaceRelative } from "./tree-model";

const ACTIVITY_TTL_MS = 60_000;
const STATUS_TTL_MS = 15 * 60_000;

type ActivityState = {
  parentThreadId: string | null;
  files: Map<string, LiveActivityFile>;
  status: Map<string, LiveActivityStatus>;
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try { assertWorkspaceRelative(value.replaceAll("\\", "/")); return true; } catch { return false; }
}

export function countDiff(diff: string | undefined): { additions: number; deletions: number } {
  if (!diff) return { additions: 0, deletions: 0 };
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}

function itemFromRow(row: unknown): Record<string, unknown> | null {
  const source = object(row);
  const data = object(source?.data);
  return object(data?.item) ?? data ?? source;
}

function recordItem(state: ActivityState, item: Record<string, unknown>, threadId: string, now: number) {
  const type = item.type;
  if (type === "fileRead" && validPath(item.path)) {
    const previous = state.files.get(item.path);
    state.files.set(item.path, {
      threadId,
      parentThreadId: state.parentThreadId,
      path: item.path,
      kind: "read",
      atMs: now,
      additions: previous?.additions ?? 0,
      deletions: previous?.deletions ?? 0,
    });
    return;
  }
  if (type !== "fileChange" || !Array.isArray(item.changes)) return;
  for (const rawChange of item.changes) {
    const change = object(rawChange);
    if (!change || !validPath(change.path)) continue;
    const previous = state.files.get(change.path);
    const diff = countDiff(typeof change.diff === "string" ? change.diff : undefined);
    state.files.set(change.path, {
      threadId,
      parentThreadId: state.parentThreadId,
      path: change.path,
      kind: "write",
      atMs: now,
      additions: (previous?.additions ?? 0) + diff.additions,
      deletions: (previous?.deletions ?? 0) + diff.deletions,
    });
    if (change.kind === "add") state.status.set(change.path, { path: change.path, addedAt: now, deletedAt: null });
    if (change.kind === "delete") state.status.set(change.path, { path: change.path, addedAt: null, deletedAt: now });
  }
}

function prune(state: ActivityState, now: number) {
  for (const [path, file] of state.files) if (now - file.atMs > ACTIVITY_TTL_MS) state.files.delete(path);
  for (const [path, marker] of state.status) {
    const latest = Math.max(marker.addedAt ?? 0, marker.deletedAt ?? 0);
    if (now - latest > STATUS_TTL_MS) state.status.delete(path);
  }
}

export function createLiveActivityCollector(bb: BbPluginApi) {
  const states = new Map<string, ActivityState>();

  async function sync(thread: { id: string; parentThreadId?: string | null }): Promise<LiveActivityOutput> {
    const now = Date.now();
    const state: ActivityState = { parentThreadId: thread.parentThreadId ?? null, files: new Map(), status: new Map() };
    const rows = await bb.sdk.threads.events.list({
      threadId: thread.id,
      order: "asc",
      limit: "50",
      types: ["item/started", "item/completed"],
    });
    for (const row of rows) {
      const item = itemFromRow(row);
      if (item) recordItem(state, item, thread.id, now);
    }
    prune(state, now);
    states.set(thread.id, state);
    return { threadId: thread.id, parentThreadId: state.parentThreadId, files: [...state.files.values()], status: [...state.status.values()] };
  }

  function snapshot(threadId: string): LiveActivityOutput {
    const state = states.get(threadId) ?? { parentThreadId: null, files: new Map(), status: new Map() };
    prune(state, Date.now());
    return { threadId, parentThreadId: state.parentThreadId, files: [...state.files.values()], status: [...state.status.values()] };
  }

  return { sync, snapshot };
}

export { ACTIVITY_TTL_MS, STATUS_TTL_MS };
