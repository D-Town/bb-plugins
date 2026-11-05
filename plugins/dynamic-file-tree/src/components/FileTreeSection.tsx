import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { experimental_Icon as Icon, useBbNavigate, useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { ExperimentalThreadTabProps } from "@get-bb/plugin-sdk/app";
import { activeAncestorPaths } from "../activity-model";
import { activityUpdatedSchema, rpcContract } from "../contracts";
import type { ActivitySnapshotOutput, FilePreviewOutput, ListTreeOutput, TreeEntry } from "../contracts";

type DirectoryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; result: ListTreeOutput; refreshing?: boolean; refreshError?: string };

interface ExplorerState {
  manualExpanded: ReadonlySet<string>;
  autoExpanded: ReadonlySet<string>;
  selectedPath: string | null;
  directories: ReadonlyMap<string, DirectoryState>;
  preview: { path: string; result: FilePreviewOutput | null } | null;
}

const gitStateLabels: Record<NonNullable<TreeEntry["gitState"]>, string> = {
  clean: "clean",
  modified: "modified",
  added: "added",
  deleted: "deleted",
  renamed: "renamed",
  untracked: "untracked",
};
const gitMarkers = { clean: "", modified: "M", added: "A", deleted: "D", renamed: "R", untracked: "U" };
const fileIcons: Record<string, string> = {
  ts: "FileCode", tsx: "FileCode", js: "FileCode", jsx: "FileCode", py: "FileCode", rs: "FileCode", go: "FileCode",
  md: "FileText", mdx: "FileText", txt: "FileText", rst: "FileText",
  png: "Image", jpg: "Image", jpeg: "Image", gif: "Image", svg: "Image", webp: "Image", ico: "Image",
  json: "Settings", yaml: "Settings", yml: "Settings", toml: "Settings",
};
function entryIcon(entry: TreeEntry, expanded: boolean) {
  if (entry.kind === "directory") return expanded ? "FolderOpen" : "Folder";
  if ([".gitignore", ".gitattributes", ".editorconfig", ".npmrc", ".env"].includes(entry.name.toLowerCase())) return "Settings";
  return fileIcons[entry.name.split(".").at(-1)!.toLowerCase()] ?? "File";
}
const previewErrors: Record<Extract<FilePreviewOutput, { outcome: "unavailable" }>["reason"], string> = {
  unsupported: "Unsupported file type for inline preview. Open this file in BB's preview-capable surface.",
  too_large: "This file is too large for inline preview (64 KiB limit).",
  invalid_path: "This file path is unavailable.",
  no_workspace: "No workspace is available for preview.",
  environment_unavailable: "The workspace is currently unavailable.",
  file_unavailable: "This file could not be previewed.",
};

// Scoped styles keep host typography/colors and the tree's roving focus model.
const explorerStyles = `
.dynamic-file-tree { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-size: 12px; padding: 4px 0; }
.dynamic-file-tree .file-tree-entry { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; height: 26px; padding: 0 8px 0 4px; border: 0; border-radius: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.dynamic-file-tree .file-tree-entry:hover { background: var(--muted, color-mix(in srgb, currentColor 7%, transparent)); }
.dynamic-file-tree [role=treeitem][aria-selected=true] > .file-tree-entry { background: var(--accent, color-mix(in srgb, currentColor 12%, transparent)); }
.dynamic-file-tree [role=treeitem]:focus { outline: none; }
.dynamic-file-tree [role=treeitem]:focus-visible > .file-tree-entry { outline: 1px solid var(--ring, currentColor); outline-offset: -1px; }
.dynamic-file-tree .file-tree-icon { width: 14px; height: 14px; flex: 0 0 14px; opacity: .8; }
.dynamic-file-tree .file-tree-chevron { width: 12px; height: 12px; flex: 0 0 12px; }
.dynamic-file-tree .file-tree-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dynamic-file-tree .file-tree-git-state { margin-left: auto; padding-left: 8px; font-size: 11px; font-weight: 600; }
.dynamic-file-tree [data-git=modified], .dynamic-file-tree [data-git=renamed] { color: var(--warning, #ad7900); }
.dynamic-file-tree [data-git=added], .dynamic-file-tree [data-git=untracked] { color: var(--success, #38854b); }
.dynamic-file-tree [data-git=deleted] { color: var(--destructive, #cf4545); }
.dynamic-file-tree .file-tree-preview { border-top: 1px solid var(--border, color-mix(in srgb, currentColor 16%, transparent)); margin-top: 8px; padding: 8px; }
.dynamic-file-tree .file-tree-preview pre { max-height: 320px; overflow: auto; font: inherit; white-space: pre; }
`;

function StatusMessage({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div role="status" aria-label={label} style={{ padding: "8px 4px", fontSize: 12, opacity: 0.75 }}>
      {children}
    </div>
  );
}

export function FileTreeView(props: ExperimentalThreadTabProps) {
  if (props.environment === null) return <StatusMessage>No active workspace.</StatusMessage>;
  return (
    <ContextExplorer
      key={JSON.stringify([props.threadId, props.environment.id])}
      threadId={props.threadId}
      environmentId={props.environment.id}
    />
  );
}

function ContextExplorer({ threadId, environmentId }: { threadId: string; environmentId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const connectionState = useRealtimeConnectionState();
  const [state, setState] = useState<ExplorerState>(() => ({
    manualExpanded: new Set(),
    autoExpanded: new Set(),
    selectedPath: null,
    directories: new Map(),
    preview: null,
  }));
  // Synchronous cache access also deduplicates requests before React commits.
  const stateRef = useRef(state);
  const mounted = useRef(false);
  const latestSequence = useRef<number | null>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const treeHasFocus = useRef(false);
  const inFlightDirectories = useRef(new Set<string>());
  const refreshAgain = useRef(new Set<string>());
  const pendingWrites = useRef(new Map<string, string>());
  const completedWrites = useRef(new Set<string>());
  const gitRequest = useRef(0);
  const previewRequest = useRef(0);
  const updateState = useCallback((change: (current: ExplorerState) => ExplorerState) => {
    const next = change(stateRef.current);
    stateRef.current = next;
    setState(next);
  }, []);

  const loadDirectory = useCallback((path: string, retry = false): void => {
    if (!mounted.current) return;
    const cached = stateRef.current.directories.get(path);
    if (inFlightDirectories.current.has(path)) {
      if (retry) refreshAgain.current.add(path);
      return;
    }
    if (cached !== undefined && !retry) return;
    inFlightDirectories.current.add(path);
    const save = (directory: DirectoryState) => {
      updateState((current) => ({
        ...current,
        directories: new Map(current.directories).set(path, directory),
      }));
    };
    // Keep existing rows mounted during refresh so focus/selection do not blink.
    save(cached?.status === "loaded" && cached.result.outcome === "available"
      ? { ...cached, refreshing: true, refreshError: undefined } : { status: "loading" });
    rpc.call("tree_list", { environmentId, path }).then(
      (result) => {
        if (!mounted.current) return;
        if (result.outcome === "unavailable" && cached?.status === "loaded" && cached.result.outcome === "available") {
          save({ ...cached, refreshing: false, refreshError: "Directory refresh unavailable." });
          return;
        }
        updateState((current) => {
          const directories = new Map(current.directories).set(path, { status: "loaded", result } as DirectoryState);
          if (result.outcome !== "available" || result.truncated) return { ...current, directories };
          const previous = current.directories.get(path);
          const entriesByPath = new Map(result.entries.map((entry) => [entry.path, entry]));
          const removed = previous?.status === "loaded" && previous.result.outcome === "available"
            ? previous.result.entries.filter((old) => entriesByPath.get(old.path)?.kind !== old.kind).map((entry) => entry.path) : [];
          const missing = (candidate: string) => {
            if (removed.some((removed) => candidate === removed || candidate.startsWith(`${removed}/`))) return true;
            // A previous truncated result might not have included this selected/cached path.
            const relative = path === "" ? candidate : candidate.startsWith(`${path}/`) ? candidate.slice(path.length + 1) : "";
            if (!relative) return false;
            const [name, ...descendants] = relative.split("/");
            const child = entriesByPath.get(path ? `${path}/${name}` : name);
            return child === undefined || (descendants.length > 0 && child.kind !== "directory");
          };
          for (const directory of directories.keys()) if (missing(directory)) directories.delete(directory);
          const selectionMissing = current.selectedPath !== null && missing(current.selectedPath);
          return {
            ...current, directories,
            manualExpanded: new Set([...current.manualExpanded].filter((candidate) => !missing(candidate))),
            autoExpanded: new Set([...current.autoExpanded].filter((candidate) => !missing(candidate))),
            selectedPath: selectionMissing ? null : current.selectedPath,
            preview: selectionMissing ? null : current.preview,
          };
        });
      },
      (cause: unknown) => {
        if (!mounted.current) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        save(cached?.status === "loaded" && cached.result.outcome === "available"
          ? { ...cached, refreshing: false, refreshError: message } : { status: "error", message });
      },
    ).finally(() => {
      inFlightDirectories.current.delete(path);
      if (refreshAgain.current.delete(path)) loadDirectory(path, true);
    });
  }, [environmentId, rpc, updateState]);

  const refreshChangedPaths = useCallback((paths: string[]) => {
    const parents = new Set<string>();
    for (const path of paths) {
      let parent = path.slice(0, Math.max(0, path.lastIndexOf("/")));
      while (parent && !stateRef.current.directories.has(parent)) parent = parent.slice(0, Math.max(0, parent.lastIndexOf("/")));
      if (stateRef.current.directories.has(parent)) parents.add(parent);
    }
    const requestedEntries = new Map([...stateRef.current.directories.values()].flatMap((directory) =>
      directory.status === "loaded" && directory.result.outcome === "available" ? directory.result.entries.map((entry) => [entry.path, entry] as const) : []));
    const annotationPaths = [...requestedEntries.keys()];
    for (const parent of parents) loadDirectory(parent, true);
    const request = ++gitRequest.current;
    // Each directory is bounded; several manually opened directories can exceed one RPC batch.
    for (let offset = 0; offset < annotationPaths.length; offset += 10_000) {
      rpc.call("tree_git", { environmentId, paths: annotationPaths.slice(offset, offset + 10_000) }).then((annotations) => {
        if (!mounted.current || request !== gitRequest.current) return;
        const states = new Map(annotations.entries.map((entry) => [entry.path, entry.gitState]));
        updateState((current) => ({ ...current, directories: new Map([...current.directories].map(([path, directory]) => {
          if (directory.status !== "loaded" || directory.result.outcome !== "available") return [path, directory];
          return [path, { ...directory, result: { ...directory.result, gitAvailable: annotations.gitAvailable,
            // A directory listing may have supplied fresher annotations while this request ran.
            entries: directory.result.entries.map((entry) => states.has(entry.path) && entry === requestedEntries.get(entry.path) ? { ...entry, gitState: states.get(entry.path) } : entry),
          } }];
        })) }));
      }, () => { /* Annotation failure must not disturb file membership. */ });
    }
  }, [environmentId, loadDirectory, rpc, updateState]);

  const applyActivity = useCallback((snapshot: ActivitySnapshotOutput) => {
    updateState((current) => ({
      ...current,
      autoExpanded: new Set(snapshot.available ? activeAncestorPaths(snapshot.activities) : []),
    }));
    if (!snapshot.available) return; // Preserve write tracking through connection/timeline outages.
    const writes = snapshot.activities.filter((activity) => activity.kind === "write");
    const pending = new Map(writes.filter((activity) => activity.status === "pending").map((activity) => [JSON.stringify([activity.activityId, activity.path]), activity.path]));
    const changed = new Set<string>();
    for (const [id, path] of pendingWrites.current) {
      if (!pending.has(id)) { changed.add(path); completedWrites.current.add(id); }
    }
    for (const activity of writes) {
      const id = JSON.stringify([activity.activityId, activity.path]);
      if (activity.status !== "pending" && !completedWrites.current.has(id)) {
        changed.add(activity.path);
        completedWrites.current.add(id);
      }
    }
    pendingWrites.current = pending;
    if (changed.size) refreshChangedPaths([...changed]);
  }, [refreshChangedPaths, updateState]);

  useRealtime("activity-updated", (payload) => {
    const parsed = activityUpdatedSchema.safeParse(payload);
    if (!mounted.current || connectionState !== "connected" || !parsed.success || parsed.data.threadId !== threadId) return;
    if (latestSequence.current !== null && parsed.data.sequence <= latestSequence.current) return;
    latestSequence.current = parsed.data.sequence;
    applyActivity(parsed.data);
  });

  useEffect(() => {
    mounted.current = true;
    loadDirectory("");
    return () => {
      mounted.current = false;
    };
  }, [loadDirectory]);

  useEffect(() => {
    if (connectionState !== "connected") {
      applyActivity({ available: false, activities: [] });
      return;
    }
    let active = true;
    // Preserve the sequence high-water mark across outages. Reconciliation is
    // valid only if no newer realtime event arrived after this request began.
    const sequenceAtRequest = latestSequence.current;
    rpc.call("activity_snapshot", { threadId }).then(
      (snapshot) => {
        if (active && latestSequence.current === sequenceAtRequest) applyActivity(snapshot);
      },
      () => {
        if (active && latestSequence.current === sequenceAtRequest) applyActivity({ available: false, activities: [] });
      },
    );
    return () => {
      active = false;
    };
  }, [connectionState, threadId, rpc, applyActivity]);

  useEffect(() => {
    // Walk only known directories, so activity cannot fetch a leaf or skip an
    // unloaded ancestor. A parent's result unlocks the next directory in the chain.
    for (const path of state.autoExpanded) {
      const parent = path.slice(0, Math.max(0, path.lastIndexOf("/")));
      const cached = state.directories.get(parent);
      if (cached?.status === "loaded" && cached.result.outcome === "available" &&
          cached.result.entries.some((entry) => entry.path === path && entry.kind === "directory")) {
        loadDirectory(path);
      }
    }
  }, [state.autoExpanded, state.directories, loadDirectory]);

  const toggle = (path: string) => {
    const opening = !stateRef.current.manualExpanded.has(path);
    updateState((current) => {
      const manualExpanded = new Set(current.manualExpanded);
      if (opening) manualExpanded.add(path);
      else manualExpanded.delete(path);
      return { ...current, manualExpanded };
    });
    if (opening) loadDirectory(path);
  };

  const select = (path: string) => {
    const request = ++previewRequest.current;
    updateState((current) => ({ ...current, selectedPath: path, preview: null }));
    const accepted = navigate.experimental_openFilePreview({
      target: { kind: "workspace", environmentId, path },
      location: null,
    });
    if (accepted) return;
    updateState((current) => ({ ...current, preview: { path, result: null } }));
    const savePreview = (result: FilePreviewOutput) => {
      if (!mounted.current || request !== previewRequest.current) return;
      updateState((current) => current.preview?.path === path && current.selectedPath === path
        ? { ...current, preview: { path, result } } : current);
    };
    rpc.call("file_preview", { environmentId, path }).then(savePreview, () => savePreview({ outcome: "unavailable", reason: "file_unavailable" }));
  };

  const isExpanded = (path: string) => state.manualExpanded.has(path) || state.autoExpanded.has(path);
  const visibleRows: { entry: TreeEntry; parent: string }[] = [];
  function collectRows(path: string) {
    const cached = state.directories.get(path);
    if (cached?.status !== "loaded" || cached.result.outcome !== "available") return;
    for (const entry of cached.result.entries) {
      visibleRows.push({ entry, parent: path });
      if (entry.kind === "directory" && isExpanded(entry.path)) collectRows(entry.path);
    }
  }
  collectRows("");
  const visiblePaths = new Set(visibleRows.map(({ entry }) => entry.path));
  let tabStop = focusedPath ?? "";
  // If activity collapses the focused branch, retain the nearest visible ancestor.
  while (tabStop && !visiblePaths.has(tabStop)) {
    tabStop = tabStop.slice(0, Math.max(0, tabStop.lastIndexOf("/")));
  }
  tabStop ||= visibleRows[0]?.entry.path ?? "";

  useLayoutEffect(() => {
    if (focusedPath !== null && focusedPath !== tabStop) {
      setFocusedPath(tabStop || null);
      if (treeHasFocus.current) rows.current.get(tabStop)?.focus();
    }
  }, [focusedPath, tabStop]);

  const focusRow = (path: string | undefined) => {
    if (!path) return;
    setFocusedPath(path);
    rows.current.get(path)?.focus();
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, entry: TreeEntry) => {
    // Treeitems contain their descendants; handle a key only at its focused row.
    if (event.target !== event.currentTarget) return;
    const index = visibleRows.findIndex((row) => row.entry.path === entry.path);
    switch (event.key) {
      case "ArrowDown":
        focusRow(visibleRows[index + 1]?.entry.path);
        break;
      case "ArrowUp":
        focusRow(visibleRows[index - 1]?.entry.path);
        break;
      case "Home":
        focusRow(visibleRows[0]?.entry.path);
        break;
      case "End":
        focusRow(visibleRows.at(-1)?.entry.path);
        break;
      case "ArrowRight": {
        if (entry.kind !== "directory") break;
        if (!isExpanded(entry.path)) {
          toggle(entry.path);
        } else {
          const cached = state.directories.get(entry.path);
          if (cached?.status === "error" || (cached?.status === "loaded" && (cached.result.outcome === "unavailable" || cached.refreshError))) {
            loadDirectory(entry.path, true);
          } else if (visibleRows[index + 1]?.parent === entry.path) {
            focusRow(visibleRows[index + 1].entry.path);
          }
        }
        break;
      }
      case "ArrowLeft":
        if (entry.kind === "directory" && isExpanded(entry.path)) {
          updateState((current) => {
            const manualExpanded = new Set(current.manualExpanded);
            const autoExpanded = new Set(current.autoExpanded);
            manualExpanded.delete(entry.path);
            // Explicit keyboard collapse applies even to an activity-opened row.
            // A subsequent activity update can restore its automatic expansion.
            autoExpanded.delete(entry.path);
            return { ...current, manualExpanded, autoExpanded };
          });
        } else {
          focusRow(visibleRows[index]?.parent);
        }
        break;
      case "Enter":
      case " ":
        if (entry.kind === "directory") toggle(entry.path);
        else select(entry.path);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  function renderDirectory(path: string, depth: number): ReactNode {
    const cached = state.directories.get(path);
    if (cached === undefined || cached.status === "loading") {
      return <StatusMessage label={path === "" ? undefined : `Loading ${path}`}>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" style={{ marginRight: 4 }}>
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="25 13">
            <animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="1s" repeatCount="indefinite" />
          </circle>
        </svg>
        {path === "" ? "Loading files…" : "Loading…"}
      </StatusMessage>;
    }
    if (cached.status === "loaded" && cached.result.outcome === "unavailable" && path === "") {
      return <StatusMessage>
        {cached.result.reason === "no_workspace" ? "This thread has no workspace." : "The workspace is currently unavailable."}
      </StatusMessage>;
    }
    if (cached.status === "error" || cached.result.outcome === "unavailable") {
      return <div role="alert">
        Could not load {path || "files"}: {cached.status === "error" ? cached.message : "Directory unavailable."}
        <button type="button" tabIndex={path ? -1 : 0} aria-label={`Retry ${path || "files"}`} onClick={() => {
          focusRow(path);
          loadDirectory(path, true);
        }}>Retry</button>
      </div>;
    }
    const { entries, truncated } = cached.result;
    return <>
      {cached.refreshing ? <StatusMessage label={`Refreshing ${path || "files"}`}>Refreshing…</StatusMessage> : null}
      {cached.refreshError ? <div role="alert">Could not refresh {path || "files"}. <button type="button" tabIndex={path ? -1 : 0} onClick={() => loadDirectory(path, true)}>Retry refresh</button></div> : null}
      {entries.length === 0 ? <StatusMessage>No files found.</StatusMessage> : entries.map((entry) => {
        const isDirectory = entry.kind === "directory";
        const expanded = isExpanded(entry.path);
        const selected = state.selectedPath === entry.path;
        const children = state.directories.get(entry.path);
        const failed = children?.status === "error" || (children?.status === "loaded" && (children.result.outcome === "unavailable" || children.refreshError));
        return <div
          key={entry.path}
          ref={(element) => {
            if (element) rows.current.set(entry.path, element);
            else rows.current.delete(entry.path);
          }}
          role="treeitem"
          tabIndex={entry.path === tabStop ? 0 : -1}
          aria-label={entry.name}
          aria-level={depth + 1}
          aria-expanded={isDirectory ? expanded : undefined}
          aria-selected={selected}
          aria-description={[
            entry.gitState && entry.gitState !== "clean" ? `Git: ${gitStateLabels[entry.gitState]}.` : "",
            isDirectory && expanded && failed ? "Could not load children. Press ArrowRight to retry." : "",
          ].filter(Boolean).join(" ") || undefined}
          onFocus={(event) => {
            if (event.target === event.currentTarget) setFocusedPath(entry.path);
          }}
          onKeyDown={(event) => onRowKeyDown(event, entry)}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-label={entry.name}
            aria-expanded={isDirectory ? expanded : undefined}
            title={entry.path}
            onClick={() => {
              focusRow(entry.path);
              if (isDirectory) toggle(entry.path);
              else select(entry.path);
            }}
            style={{ paddingLeft: `${depth * 14 + 4}px` }}
            className="file-tree-entry"
          >
            {isDirectory ? <Icon name={expanded ? "ChevronDown" : "ChevronRight"} aria-hidden="true" className="file-tree-chevron" /> : <span aria-hidden="true" className="file-tree-chevron" />}
            <Icon name={entryIcon(entry, expanded)} fallback="File" aria-hidden="true" className="file-tree-icon" />
            <span className="file-tree-name">{entry.name}</span>
            {entry.gitState && entry.gitState !== "clean" ? <span aria-hidden="true" data-git={entry.gitState} title={`Git: ${gitStateLabels[entry.gitState]}`} className="file-tree-git-state">{gitMarkers[entry.gitState]}</span> : null}
          </button>
          {isDirectory && expanded ? <div role="group">{renderDirectory(entry.path, depth + 1)}</div> : null}
        </div>;
      })}
      {truncated ? <StatusMessage>Showing the first 10,000 paths.</StatusMessage> : null}
    </>;
  }

  return <div className="dynamic-file-tree">
    <style>{explorerStyles}</style>
    <div role="tree" aria-label="Project files"
    onFocusCapture={() => { treeHasFocus.current = true; }}
    onBlurCapture={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) treeHasFocus.current = false;
    }}
  >{renderDirectory("", 0)}</div>
    {state.preview ? <section aria-label="File preview" className="file-tree-preview">
      <div title={state.preview.path}>{state.preview.path}</div>
      {state.preview.result === null ? <StatusMessage>Loading preview…</StatusMessage>
        : state.preview.result.outcome === "available" ? <pre tabIndex={0} aria-label={`Preview of ${state.preview.path}`}>{state.preview.result.content}</pre>
          : <div role="status">{previewErrors[state.preview.result.reason]}</div>}
    </section> : null}
  </div>;
}
