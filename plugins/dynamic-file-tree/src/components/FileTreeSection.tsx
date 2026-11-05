import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
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
    if (!mounted.current || !parsed.success || parsed.data.threadId !== threadId) return;
    if (latestSequence.current !== null && parsed.data.sequence <= latestSequence.current) return;
    latestSequence.current = parsed.data.sequence;
    applyActivity(parsed.data);
  });

  useEffect(() => {
    mounted.current = true;
    // A late mount snapshot must not replace newer realtime activity.
    let active = true;
    loadDirectory("");
    rpc.call("activity_snapshot", { threadId }).then(
      (snapshot) => {
        if (active && latestSequence.current === null) applyActivity(snapshot);
      },
      () => {
        if (active && latestSequence.current === null) applyActivity({ available: false, activities: [] });
      },
    );
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [threadId, rpc, loadDirectory, applyActivity]);

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
        <button type="button" aria-label={`Retry ${path || "files"}`} onClick={() => loadDirectory(path, true)}>Retry</button>
      </div>;
    }
    const { entries, truncated } = cached.result;
    return <>
      {entries.length === 0 ? <StatusMessage>No files found.</StatusMessage> : entries.map((entry) => {
        const isDirectory = entry.kind === "directory";
        const expanded = state.manualExpanded.has(entry.path) || state.autoExpanded.has(entry.path);
        const selected = state.selectedPath === entry.path;
        return <div
          key={entry.path}
          role="treeitem"
          aria-label={entry.name}
          aria-level={depth + 1}
          aria-expanded={isDirectory ? expanded : undefined}
          aria-selected={selected}
        >
          <button
            type="button"
            aria-label={entry.name}
            aria-expanded={isDirectory ? expanded : undefined}
            onClick={() => isDirectory ? toggle(entry.path) : select(entry.path)}
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

  return <div role="tree" aria-label="Project files">{renderDirectory("", 0)}</div>;
}
