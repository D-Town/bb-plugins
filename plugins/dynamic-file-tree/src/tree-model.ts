export type GitState =
  | "clean"
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked";

export type ListedPath = {
  path: string;
  kind: "file" | "directory";
  hasChildren?: boolean;
  gitState?: GitState;
  additions?: number;
  deletions?: number;
};

export type TreeEntry = ListedPath & {
  name: string;
  children?: TreeEntry[];
};

export function assertWorkspaceRelative(path: string): string[] {
  const segments = path.split("/");
  if (
    path.trim() === "" || path.includes("\\") || path.includes("\0") ||
    /^[a-z]:/i.test(path) ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`Path must be workspace-relative: ${path}`);
  }
  return segments;
}

function compareEntries(left: TreeEntry, right: TreeEntry): number {
  if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

// Each input is already a direct child of the requested directory. Missing
// children means unloaded; never turn it into a known-empty children array.
export function buildTree(entries: readonly ListedPath[]): TreeEntry[] {
  const unique = new Map<string, TreeEntry>();
  for (const entry of entries) {
    const segments = assertWorkspaceRelative(entry.path);
    unique.set(entry.path, { ...entry, name: segments.at(-1)! });
  }
  return [...unique.values()].sort(compareEntries);
}
