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

function relativePath(value: unknown, rootPath: string | null, cwd: string | null): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  let path = value.replaceAll("\\", "/").replace(/^['\"]|['\"]$/g, "").replace(/[),;]+$/, "");
  if (rootPath && path.startsWith(`${rootPath}/`)) path = path.slice(rootPath.length + 1);
  else if (cwd && path.startsWith(`${cwd}/`)) path = path.slice(cwd.length + 1);
  else if (path.startsWith("/")) return null;
  try { assertWorkspaceRelative(path); return path; } catch { return null; }
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

function eventItem(row: unknown): { eventType: "item/started" | "item/completed"; itemId: string; item: Record<string, unknown> } | null {
  const source = object(row);
  const eventType = source?.type;
  if (eventType !== "item/started" && eventType !== "item/completed") return null;
  const item = itemFromRow(row);
  if (item === null) return null;
  const itemId = typeof item.id === "string" && item.id.length > 0 ? item.id : null;
  return itemId === null ? null : { eventType, itemId, item };
}

function recordItem(state: ActivityState, item: Record<string, unknown>, threadId: string, now: number, rootPath: string | null, active: boolean) {
  const type = item.type;
  const cwd = typeof item.cwd === "string" ? item.cwd.replaceAll("\\", "/").replace(/\/$/, "") : null;
  if (type === "fileRead") {
    if (!active) return;
    const path = relativePath(item.path, rootPath, cwd);
    if (!path) return;
    const previous = state.files.get(path);
    state.files.set(path, {
      threadId,
      parentThreadId: state.parentThreadId,
      path,
      kind: "read",
      atMs: now,
      additions: previous?.additions ?? 0,
      deletions: previous?.deletions ?? 0,
    });
    return;
  }
  if (type === "fileChange" && Array.isArray(item.changes)) {
  for (const rawChange of item.changes) {
    const change = object(rawChange);
    const path = relativePath(change?.path, rootPath, cwd);
    if (!change || !path) continue;
    const previous = state.files.get(path);
    const diff = countDiff(typeof change.diff === "string" ? change.diff : undefined);
    if (active) {
      state.files.set(path, {
        threadId,
        parentThreadId: state.parentThreadId,
        path,
        kind: "write",
        atMs: now,
        additions: (previous?.additions ?? 0) + diff.additions,
        deletions: (previous?.deletions ?? 0) + diff.deletions,
      });
    }
    if (change.kind === "add") state.status.set(path, { path, addedAt: now, deletedAt: null });
    if (change.kind === "delete") state.status.set(path, { path, addedAt: null, deletedAt: now });
  }
  return;
  }

  // Codex and shell-backed providers often expose reads/writes as command
  // executions instead of provider-native fileRead/fileChange items. Recover
  // the workspace paths from common read commands and apply_patch blocks so
  // the tree still follows what is visibly happening in the transcript.
  if (type !== "commandExecution" || typeof item.command !== "string") return;
  const command = item.command;
  const readCommand = /\b(?:sed|cat|head|tail|less|more|rg|grep|find|git\s+(?:diff|show|blame))\b/.test(command);
  const patchPaths = [...command.matchAll(/\*\*\*\s+(Update|Add|Delete)\s+File:\s*([^\r\n]+)/g)];
  for (const match of patchPaths) {
    const path = relativePath(match[2], rootPath, cwd);
    if (!path) continue;
    const previous = state.files.get(path);
    const kind = match[1] === "Delete" ? "delete" : match[1] === "Add" ? "add" : "update";
    if (active) {
      state.files.set(path, { threadId, parentThreadId: state.parentThreadId, path, kind: "write", atMs: now, additions: previous?.additions ?? 0, deletions: previous?.deletions ?? 0 });
    }
    if (kind === "add") state.status.set(path, { path, addedAt: now, deletedAt: null });
    if (kind === "delete") state.status.set(path, { path, addedAt: null, deletedAt: now });
  }
  if (!readCommand) return;
  const candidates = command.match(/(?<!:)\/(?:[^\s"'`;&|]+\/)*[^\s"'`;&|]+|(?:\.\/)?(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+|(?<![\w./-])[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]+/g) ?? [];
  for (const candidate of candidates) {
    const path = relativePath(candidate, rootPath, cwd);
    if (!path) continue;
    const previous = state.files.get(path);
    state.files.set(path, { threadId, parentThreadId: state.parentThreadId, path, kind: "read", atMs: now, additions: previous?.additions ?? 0, deletions: previous?.deletions ?? 0 });
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

  async function sync(thread: { id: string; parentThreadId?: string | null; environmentId?: string | null }): Promise<LiveActivityOutput> {
    const now = Date.now();
    const state: ActivityState = { parentThreadId: thread.parentThreadId ?? null, files: new Map(), status: new Map() };
    let rootPath: string | null = null;
    if (thread.environmentId) {
      try { rootPath = (await bb.sdk.environments.get({ environmentId: thread.environmentId })).path?.replaceAll("\\", "/").replace(/\/$/, "") ?? null; } catch { /* Activity still works for relative paths. */ }
    }
    const rows = await bb.sdk.threads.events.list({
      threadId: thread.id,
      order: "desc",
      limit: "50",
      types: ["item/started", "item/completed"],
    });
    const started = new Map<string, Record<string, unknown>>();
    const completed = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const event = eventItem(row);
      if (!event) continue;
      if (event.eventType === "item/started") started.set(event.itemId, event.item);
      else completed.set(event.itemId, event.item);
    }
    for (const item of completed.values()) recordItem(state, item, thread.id, now, rootPath, false);
    for (const [itemId, item] of started) {
      if (!completed.has(itemId)) recordItem(state, item, thread.id, now, rootPath, true);
    }
    prune(state, now);
    states.set(thread.id, state);
    return { threadId: thread.id, parentThreadId: state.parentThreadId, files: [...state.files.values()], status: [...state.status.values()] };
  }

  async function syncById(threadId: string): Promise<LiveActivityOutput> {
    const thread = await bb.sdk.threads.get({ threadId });
    return sync(thread);
  }

  function snapshot(threadId: string): LiveActivityOutput {
    const state = states.get(threadId) ?? { parentThreadId: null, files: new Map(), status: new Map() };
    prune(state, Date.now());
    return { threadId, parentThreadId: state.parentThreadId, files: [...state.files.values()], status: [...state.status.values()] };
  }

  return { sync, syncById, snapshot };
}

export { ACTIVITY_TTL_MS, STATUS_TTL_MS };
