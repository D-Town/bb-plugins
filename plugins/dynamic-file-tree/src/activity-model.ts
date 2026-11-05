import type { ActivePathActivity } from "./contracts";
import { assertWorkspaceRelative } from "./tree-model";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function safePath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    assertWorkspaceRelative(value);
    return true;
  } catch {
    return false;
  }
}

export function collectActiveActivities(rows: readonly unknown[]): ActivePathActivity[] {
  const activities: ActivePathActivity[] = [];
  function visit(rows: readonly unknown[]) {
    for (const value of rows) {
      const row = record(value);
      if (!row) continue;
      if (row.kind === "turn") {
        // A terminal turn must not leave stale pending child indicators behind.
        if (row.status === "completed" || row.status === "error" || row.status === "interrupted") continue;
        if (Array.isArray(row.children)) visit(row.children);
        continue;
      }
      if (row.kind !== "work" || row.status !== "pending" || typeof row.id !== "string" || row.id.length === 0) continue;
      const activityId = row.id;
      const add = (path: unknown, kind: ActivePathActivity["kind"]) => {
        if (safePath(path)) activities.push({ activityId, path, kind, status: "pending" });
      };
      switch (row.workKind) {
        case "file-read":
          add(row.path, "read");
          break;
        case "file-change":
          add(record(row.change)?.path, "write");
          break;
        case "search":
          add(row.path, row.mode === "list" ? "list" : "search");
          break;
        case "command":
          if (!Array.isArray(row.activityIntents)) break;
          for (const value of row.activityIntents) {
            const intent = record(value);
            if (intent?.type === "read" || intent?.type === "search") add(intent.path, intent.type);
            else if (intent?.type === "list_files") add(intent.path, "list");
          }
          break;
      }
    }
  }
  visit(rows);
  return activities;
}

export function ancestorPaths(path: string): string[] {
  if (!safePath(path)) return [];
  const segments = path.split("/");
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"));
}

export function activeAncestorPaths(activities: readonly ActivePathActivity[]): string[] {
  return [...new Set(activities.filter((activity) => activity.status === "pending")
    .flatMap((activity) => ancestorPaths(activity.path)))];
}
