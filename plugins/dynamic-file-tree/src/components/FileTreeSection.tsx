import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useBbNavigate, useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { ExperimentalThreadTabProps } from "@get-bb/plugin-sdk/app";
import { activeAncestorPaths } from "../activity-model";
import { activityUpdatedSchema, rpcContract } from "../contracts";
import type { ActivitySnapshotOutput, ListTreeOutput, TreeEntry } from "../contracts";

type DirectoryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; result: ListTreeOutput };

interface ExplorerState {
  manualExpanded: ReadonlySet<string>;
  autoExpanded: ReadonlySet<string>;
  selectedPath: string | null;
  directories: ReadonlyMap<string, DirectoryState>;
}

const gitStateLabels: Record<NonNullable<TreeEntry["gitState"]>, string> = {
  clean: "clean",
  modified: "modified",
  added: "added",
  deleted: "deleted",
  renamed: "renamed",
  untracked: "untracked",
};

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
  }));
  // Synchronous cache access also deduplicates requests before React commits.
  const stateRef = useRef(state);
  const mounted = useRef(false);
  const latestSequence = useRef<number | null>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const treeHasFocus = useRef(false);
  const updateState = useCallback((change: (current: ExplorerState) => ExplorerState) => {
    const next = change(stateRef.current);
    stateRef.current = next;
    setState(next);
  }, []);

  const loadDirectory = useCallback((path: string, retry = false) => {
    if (!mounted.current) return;
    const cached = stateRef.current.directories.get(path);
    if (cached?.status === "loading" || (cached !== undefined && !retry)) return;
    const save = (directory: DirectoryState) => {
      updateState((current) => ({
        ...current,
        directories: new Map(current.directories).set(path, directory),
      }));
    };
    save({ status: "loading" });
    rpc.call("tree_list", { environmentId, path }).then(
      (result) => {
        if (mounted.current) save({ status: "loaded", result });
      },
      (cause: unknown) => {
        if (mounted.current) save({ status: "error", message: cause instanceof Error ? cause.message : String(cause) });
      },
    );
  }, [environmentId, rpc, updateState]);

  const applyActivity = useCallback((snapshot: ActivitySnapshotOutput) => {
    updateState((current) => ({
      ...current,
      autoExpanded: new Set(snapshot.available ? activeAncestorPaths(snapshot.activities) : []),
    }));
  }, [updateState]);

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
    updateState((current) => ({ ...current, selectedPath: path }));
    navigate.experimental_openFilePreview({
      target: { kind: "workspace", environmentId, path },
      location: null,
    });
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
          if (cached?.status === "error" || (cached?.status === "loaded" && cached.result.outcome === "unavailable")) {
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
      {entries.length === 0 ? <StatusMessage>No files found.</StatusMessage> : entries.map((entry) => {
        const isDirectory = entry.kind === "directory";
        const expanded = isExpanded(entry.path);
        const selected = state.selectedPath === entry.path;
        const children = state.directories.get(entry.path);
        const failed = children?.status === "error" || (children?.status === "loaded" && children.result.outcome === "unavailable");
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
          aria-description={isDirectory && expanded && failed ? "Could not load children. Press ArrowRight to retry." : undefined}
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
            onClick={() => {
              focusRow(entry.path);
              if (isDirectory) toggle(entry.path);
              else select(entry.path);
            }}
            style={{ paddingLeft: `${depth * 14 + 4}px` }}
            className="file-tree-entry"
          >
            <span aria-hidden="true">{isDirectory ? (expanded ? "▾" : "▸") : "·"}</span>
            <span>{entry.name}</span>
            {!isDirectory && entry.gitState !== undefined ? <span className="file-tree-git-state">{gitStateLabels[entry.gitState]}</span> : null}
          </button>
          {isDirectory && expanded ? <div role="group">{renderDirectory(entry.path, depth + 1)}</div> : null}
        </div>;
      })}
      {truncated ? <StatusMessage>Showing the first 10,000 paths.</StatusMessage> : null}
    </>;
  }

  return <div role="tree" aria-label="Project files"
    onFocusCapture={() => { treeHasFocus.current = true; }}
    onBlurCapture={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) treeHasFocus.current = false;
    }}
  >{renderDirectory("", 0)}</div>;
}
