import { useState } from "react";
import type { ReactNode } from "react";
import type { TreeEntry } from "../tree-model";

const gitStateLabels: Record<NonNullable<TreeEntry["gitState"]>, string> = {
  clean: "clean",
  modified: "modified",
  added: "added",
  deleted: "deleted",
  renamed: "renamed",
  untracked: "untracked",
};

function EntryRow({
  entry,
  depth,
  expanded,
  onToggle,
  onSelect,
}: {
  entry: TreeEntry;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const paddingLeft = `${depth * 14 + 4}px`;

  if (entry.kind === "directory") {
    return (
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        style={{ paddingLeft }}
        className="file-tree-entry"
      >
        <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
        <span>{entry.name}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-label={entry.name}
      onClick={onSelect}
      style={{ paddingLeft }}
      className="file-tree-entry"
    >
      <span aria-hidden="true">·</span>
      <span>{entry.name}</span>
      {entry.gitState === undefined ? null : (
        <span className="file-tree-git-state">{gitStateLabels[entry.gitState]}</span>
      )}
    </button>
  );
}
function renderEntries(
  entries: readonly TreeEntry[],
  depth: number,
  expandedPaths: ReadonlySet<string>,
  onToggle: (path: string) => void,
  onSelect: (path: string) => void,
): ReactNode {
  return entries.map((entry) => {
    const isExpanded = expandedPaths.has(entry.path);
    return (
      <div key={entry.path}>
        <EntryRow
          entry={entry}
          depth={depth}
          expanded={isExpanded}
          onToggle={() => onToggle(entry.path)}
          onSelect={() => onSelect(entry.path)}
        />
        {entry.kind === "directory" && isExpanded && entry.children !== undefined
          ? renderEntries(entry.children, depth + 1, expandedPaths, onToggle, onSelect)
          : null}
      </div>
    );
  });
}
export function FileTreeView({
  entries,
  onSelect,
}: {
  entries: readonly TreeEntry[];
  onSelect: (path: string) => void;
}) {
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div role="tree" aria-label="Project files">
      {entries.length === 0 ? (
        <div role="status" className="file-tree-empty">
          No files found.
        </div>
      ) : (
        renderEntries(entries, 0, expandedPaths, toggle, onSelect)
      )}
    </div>
  );
}
