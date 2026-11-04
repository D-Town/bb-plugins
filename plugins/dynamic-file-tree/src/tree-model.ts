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
  gitState?: GitState;
};

export type TreeEntry = {
  path: string;
  name: string;
  kind: "file" | "directory";
  children?: TreeEntry[];
  gitState?: GitState;
};

type MutableDirectory = TreeEntry & {
  kind: "directory";
  children: TreeEntry[];
};

function assertWorkspaceRelative(path: string): string[] {
  if (path.trim() === "" || path.startsWith("/") || path.includes("\\")) {
    throw new Error(`Path must be workspace-relative: ${path}`);
  }

  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`Path must be workspace-relative: ${path}`);
  }

  return segments;
}

function compareEntries(left: TreeEntry, right: TreeEntry): number {
  if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function sortTree(entries: TreeEntry[]): void {
  entries.sort(compareEntries);
  for (const entry of entries) {
    if (entry.kind === "directory" && entry.children !== undefined) {
      sortTree(entry.children);
    }
  }
}

export function buildTree(entries: readonly ListedPath[]): TreeEntry[] {
  const roots: TreeEntry[] = [];
  const directories = new Map<string, MutableDirectory>();

  const ensureDirectory = (segments: readonly string[]): MutableDirectory => {
    const path = segments.join("/");
    const existing = directories.get(path);
    if (existing !== undefined) return existing;

    const directory: MutableDirectory = {
      path,
      name: segments.at(-1) ?? path,
      kind: "directory",
      children: [],
    };
    directories.set(path, directory);

    const parentSegments = segments.slice(0, -1);
    if (parentSegments.length === 0) {
      roots.push(directory);
    } else {
      ensureDirectory(parentSegments).children.push(directory);
    }
    return directory;
  };

  for (const entry of entries) {
    const segments = assertWorkspaceRelative(entry.path);
    const name = segments.at(-1) ?? entry.path;
    const parentSegments = segments.slice(0, -1);

    if (entry.kind === "directory") {
      const directory = ensureDirectory(segments);
      if (entry.gitState !== undefined) directory.gitState = entry.gitState;
      continue;
    }

    const file: TreeEntry = {
      path: entry.path,
      name,
      kind: "file",
      ...(entry.gitState === undefined ? {} : { gitState: entry.gitState }),
    };
    if (parentSegments.length === 0) roots.push(file);
    else ensureDirectory(parentSegments).children.push(file);
  }

  sortTree(roots);
  return roots;
}
