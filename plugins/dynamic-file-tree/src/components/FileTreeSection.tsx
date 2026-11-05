import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { experimental_Icon as Icon, useBbNavigate, useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { ExperimentalThreadTabProps } from "@get-bb/plugin-sdk/app";
import { activeAncestorPaths, ancestorPaths } from "../activity-model";
import { activityUpdatedSchema, liveActivityOutputSchema, rpcContract } from "../contracts";
import type { ActivitySnapshotOutput, FilePreviewOutput, ListTreeOutput, TreeEntry, WorkspaceOutput } from "../contracts";

type DirectoryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; result: ListTreeOutput; refreshing?: boolean; refreshError?: string };

interface ExplorerState {
  manualExpanded: ReadonlySet<string>;
  autoExpanded: ReadonlySet<string>;
  activity: ReadonlyMap<string, { kind: "read" | "write"; atMs: number }>;
  status: ReadonlyMap<string, { addedAt: number | null; deletedAt: number | null }>;
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
type ExplorerPrefs = {
  showDiff: boolean;
  showSize: boolean;
  showMtime: boolean;
  showFullPath: boolean;
  useNerdFontIcons: boolean;
  autoCollapse: boolean;
  readColor: string;
  writeColor: string;
  addedColor: string;
  deletedColor: string;
  modifiedColor: string;
  diffAddColor: string;
  diffDeleteColor: string;
};
const defaultPrefs: ExplorerPrefs = {
  showDiff: true, showSize: false, showMtime: false, showFullPath: false, useNerdFontIcons: false, autoCollapse: true,
  readColor: "#8b5cf6", writeColor: "#f59e0b", addedColor: "#22c55e", deletedColor: "#ef4444", modifiedColor: "#ad7900",
  diffAddColor: "#38854b", diffDeleteColor: "#cf4545",
};
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
function entryGlyph(entry: TreeEntry, expanded: boolean) {
  if (entry.kind === "directory") return expanded ? "\ue5fe" : "\ue5ff";
  const extension = entry.name.split(".").at(-1)!.toLowerCase();
  if (entry.name.startsWith(".")) return "\uf013";
  return ({ ts: "\ue8ca", tsx: "\ue8ca", js: "\ue781", jsx: "\ue781", json: "\ue60b", md: "\ue73e", py: "\ue73c", go: "\ue724", rs: "\ue7a8", css: "\ue749", html: "\ue736", png: "\uf1c5", jpg: "\uf1c5", jpeg: "\uf1c5", txt: "\uf15c" } as Record<string, string>)[extension] ?? "\uf15b";
}
function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
function formatMtime(mtimeMs: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - mtimeMs) / 60_000));
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  return new Date(mtimeMs).toLocaleDateString("de-DE");
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
.dynamic-file-tree .file-tree-header { display: flex; align-items: center; gap: 7px; padding: 8px 8px 9px; border-bottom: 1px solid var(--border, color-mix(in srgb, currentColor 16%, transparent)); }
.dynamic-file-tree .file-tree-header-title { display: flex; align-items: center; gap: 6px; font-weight: 700; letter-spacing: .01em; }
.dynamic-file-tree .file-tree-header-count { opacity: .55; font-size: 10px; font-weight: 500; }
.dynamic-file-tree .file-tree-branch { opacity: .65; font-size: 10px; font-weight: 500; }
.dynamic-file-tree .file-tree-header-spacer { flex: 1; }
.dynamic-file-tree .file-tree-header-button { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: 0; border-radius: 4px; background: transparent; color: inherit; cursor: pointer; }
.dynamic-file-tree .file-tree-header-button:hover { background: var(--muted, color-mix(in srgb, currentColor 10%, transparent)); }
.dynamic-file-tree .file-tree-settings { margin: 6px 8px; padding: 7px 8px; border: 1px solid var(--border, color-mix(in srgb, currentColor 20%, transparent)); border-radius: 6px; background: var(--card, color-mix(in srgb, currentColor 4%, transparent)); }
.dynamic-file-tree .file-tree-setting { display: flex; align-items: center; gap: 7px; min-height: 25px; white-space: nowrap; }
.dynamic-file-tree .file-tree-settings-divider { height: 1px; margin: 6px 0; background: var(--border, color-mix(in srgb, currentColor 16%, transparent)); }
.dynamic-file-tree .file-tree-settings-label { margin: 4px 0; opacity: .65; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
.dynamic-file-tree .file-tree-color-setting { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 25px; white-space: nowrap; }
.dynamic-file-tree .file-tree-color-setting input[type=color] { width: 30px; height: 20px; padding: 0; border: 1px solid var(--border, color-mix(in srgb, currentColor 24%, transparent)); border-radius: 4px; background: transparent; cursor: pointer; }
.dynamic-file-tree .file-tree-glyph { width: 14px; flex: 0 0 14px; text-align: center; font-family: "JetBrainsMono Nerd Font", "FiraCode Nerd Font", "Hack Nerd Font", "Symbols Nerd Font", ui-monospace, monospace; font-size: 15px; line-height: 14px; }
.dynamic-file-tree .file-tree-entry { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; height: 26px; padding: 0 8px 0 4px; border: 0; border-radius: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.dynamic-file-tree .file-tree-entry:hover { background: var(--muted, color-mix(in srgb, currentColor 7%, transparent)); }
.dynamic-file-tree [role=treeitem][aria-selected=true] > .file-tree-entry { background: var(--accent, color-mix(in srgb, currentColor 12%, transparent)); }
.dynamic-file-tree [role=treeitem]:focus { outline: none; }
.dynamic-file-tree [role=treeitem]:focus-visible > .file-tree-entry { outline: 1px solid var(--ring, currentColor); outline-offset: -1px; }
.dynamic-file-tree .file-tree-icon { width: 14px; height: 14px; flex: 0 0 14px; opacity: .8; }
.dynamic-file-tree .file-tree-chevron { width: 12px; height: 12px; flex: 0 0 12px; }
.dynamic-file-tree .file-tree-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dynamic-file-tree .file-tree-git-state { margin-left: auto; padding-left: 8px; font-size: 11px; font-weight: 600; }
.dynamic-file-tree .file-tree-diff-stats { display: inline-flex; gap: 5px; padding-left: 8px; font-size: 10px; font-weight: 600; }
.dynamic-file-tree .file-tree-file-stat { padding-left: 7px; opacity: .55; font-size: 10px; white-space: nowrap; }
.dynamic-file-tree .file-tree-additions { color: var(--filetree-diff-add, #38854b); }
.dynamic-file-tree .file-tree-deletions { color: var(--filetree-diff-delete, #cf4545); }
.dynamic-file-tree [data-git=modified], .dynamic-file-tree [data-git=renamed] { color: var(--filetree-modified, #ad7900); }
.dynamic-file-tree [data-git=added], .dynamic-file-tree [data-git=untracked] { color: var(--filetree-added, #38854b); }
.dynamic-file-tree [data-git=deleted] { color: var(--filetree-deleted, #ef4444); }
.dynamic-file-tree .file-tree-preview { border-top: 1px solid var(--border, color-mix(in srgb, currentColor 16%, transparent)); margin-top: 8px; padding: 8px; }
.dynamic-file-tree .file-tree-preview pre { max-height: 320px; overflow: auto; font: inherit; white-space: pre; }
.dynamic-file-tree .file-tree-name, .dynamic-file-tree .file-tree-icon, .dynamic-file-tree .file-tree-glyph { transition: color 1.2s ease; }
.dynamic-file-tree .file-tree-activity-read { color: var(--filetree-read, #8b5cf6); }
.dynamic-file-tree .file-tree-activity-write { color: var(--filetree-write, #f59e0b); }
.dynamic-file-tree .file-tree-activity-read-shimmer { color: var(--filetree-read, #8b5cf6); animation: file-tree-pulse-read 1.6s ease-in-out infinite alternate; }
.dynamic-file-tree .file-tree-activity-write-shimmer { color: var(--filetree-write, #f59e0b); animation: file-tree-pulse-write 1.6s ease-in-out infinite alternate; }
.dynamic-file-tree .file-tree-status-added { padding: 0 4px; margin: 0 -4px; border-radius: 4px; background: color-mix(in srgb, var(--filetree-added, #22c55e) 13%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--filetree-added, #22c55e) 40%, transparent); }
.dynamic-file-tree .file-tree-status-deleted { padding: 0 4px; margin: 0 -4px; border-radius: 4px; background: color-mix(in srgb, var(--filetree-deleted, #ef4444) 11%, transparent); color: var(--filetree-deleted, #ef4444); text-decoration: line-through; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--filetree-deleted, #ef4444) 35%, transparent); }
@keyframes file-tree-pulse-read { from { opacity: .72; } to { opacity: 1; } }
@keyframes file-tree-pulse-write { from { opacity: .72; } to { opacity: 1; } }
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
    activity: new Map(),
    status: new Map(),
    selectedPath: null,
    directories: new Map(),
    preview: null,
  }));
  // Synchronous cache access also deduplicates requests before React commits.
  const stateRef = useRef(state);
  const mounted = useRef(false);
  const latestSequence = useRef<number | null>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<ExplorerPrefs>(defaultPrefs);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceOutput | null>(null);
  const [fileStats, setFileStats] = useState<ReadonlyMap<string, { size: number | null; mtimeMs: number | null }>>(new Map());
  const rows = useRef(new Map<string, HTMLDivElement>());
  const treeHasFocus = useRef(false);
  const inFlightDirectories = useRef(new Map<string, symbol>());
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
    // The token identifies this incarnation of the branch, including its in-flight cleanup.
    const request = Symbol(path);
    inFlightDirectories.current.set(path, request);
    const isCurrentRequest = () => mounted.current && inFlightDirectories.current.get(path) === request;
    const save = (directory: DirectoryState) => {
      if (!isCurrentRequest()) return;
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
        if (!isCurrentRequest()) return;
        if (result.outcome === "unavailable" && cached?.status === "loaded" && cached.result.outcome === "available") {
          save({ ...cached, refreshing: false, refreshError: "Directory refresh unavailable." });
          return;
        }
        updateState((current) => {
          const previous = current.directories.get(path);
          if (result.outcome === "available" && result.truncated && previous?.status === "loaded" && previous.result.outcome === "available") {
            // An incomplete listing can add/update rows, but cannot prove cached rows absent.
            const entries = new Map(previous.result.entries.map((entry) => [entry.path, entry]));
            for (const entry of result.entries) entries.set(entry.path, entry);
            return { ...current, directories: new Map(current.directories).set(path, {
              status: "loaded", result: { ...result, entries: [...entries.values()].sort((left, right) =>
                left.kind !== right.kind ? left.kind === "directory" ? -1 : 1
                  : left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
              },
            }) };
          }
          const directories = new Map(current.directories).set(path, { status: "loaded", result } as DirectoryState);
          if (result.outcome !== "available" || result.truncated) return { ...current, directories };
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
          for (const directory of directories.keys()) {
            if (!missing(directory)) continue;
            directories.delete(directory);
            // Removed descendants cannot publish late results or block a recreated branch's load.
            inFlightDirectories.current.delete(directory);
            refreshAgain.current.delete(directory);
          }
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
        if (!isCurrentRequest()) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        save(cached?.status === "loaded" && cached.result.outcome === "available"
          ? { ...cached, refreshing: false, refreshError: message } : { status: "error", message });
      },
    ).finally(() => {
      if (!isCurrentRequest()) return;
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
        const annotationsByPath = new Map(annotations.entries.map((entry) => [entry.path, entry]));
        updateState((current) => ({ ...current, directories: new Map([...current.directories].map(([path, directory]) => {
          if (directory.status !== "loaded" || directory.result.outcome !== "available") return [path, directory];
          return [path, { ...directory, result: { ...directory.result, gitAvailable: annotations.gitAvailable,
            // A directory listing may have supplied fresher annotations while this request ran.
            entries: directory.result.entries.map((entry) => {
              const annotation = annotationsByPath.get(entry.path);
              return annotation !== undefined && entry === requestedEntries.get(entry.path) ? { ...entry, ...annotation } : entry;
            }),
          } }];
        })) }));
      }, () => { /* Annotation failure must not disturb file membership. */ });
    }
  }, [environmentId, loadDirectory, rpc, updateState]);

  const applyActivity = useCallback((snapshot: ActivitySnapshotOutput) => {
    updateState((current) => {
      const activity = new Map(current.activity);
      const activePaths = new Set<string>();
      if (snapshot.available) {
        for (const item of snapshot.activities) {
          if (item.status !== "pending") continue;
          activePaths.add(item.path);
          activity.set(item.path, { kind: item.kind === "write" ? "write" : "read", atMs: Date.now() });
        }
      }
      for (const [path, value] of activity) if (!activePaths.has(path) && Date.now() - value.atMs > 30_000) activity.delete(path);
      return {
        ...current,
        activity,
        autoExpanded: new Set(snapshot.available ? activeAncestorPaths(snapshot.activities) : []),
      };
    });
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

  useEffect(() => {
    const timer = window.setInterval(() => {
      const timestamp = Date.now();
      setNow(timestamp);
      updateState((current) => {
        const activity = new Map([...current.activity].filter(([, value]) => timestamp - value.atMs <= 30_000));
        return activity.size === current.activity.size ? current : { ...current, activity };
      });
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [updateState]);

  useRealtime("activity-updated", (payload) => {
    const parsed = activityUpdatedSchema.safeParse(payload);
    if (!mounted.current || connectionState !== "connected" || !parsed.success || parsed.data.threadId !== threadId) return;
    if (latestSequence.current !== null && parsed.data.sequence <= latestSequence.current) return;
    latestSequence.current = parsed.data.sequence;
    applyActivity(parsed.data);
  });

  useRealtime("filetree-activity", (payload) => {
    const parsed = liveActivityOutputSchema.safeParse(payload);
    if (!mounted.current || !parsed.success || (parsed.data.threadId !== threadId && parsed.data.parentThreadId !== threadId)) return;
    updateState((current) => ({
      ...current,
      activity: new Map(parsed.data.files.map((file) => [file.path, { kind: file.kind, atMs: file.atMs }])),
      status: new Map(parsed.data.status.map((marker) => [marker.path, { addedAt: marker.addedAt, deletedAt: marker.deletedAt }])),
      autoExpanded: new Set(parsed.data.files.flatMap((file) => ancestorPaths(file.path))),
    }));
  });

  useEffect(() => {
    if (connectionState !== "connected") return;
    let active = true;
    rpc.call("activity", { threadId }).then((snapshot) => {
      if (!active) return;
      updateState((current) => ({
        ...current,
        activity: new Map(snapshot.files.map((file) => [file.path, { kind: file.kind, atMs: file.atMs }])),
        status: new Map(snapshot.status.map((marker) => [marker.path, { addedAt: marker.addedAt, deletedAt: marker.deletedAt }])),
        autoExpanded: new Set(snapshot.files.flatMap((file) => ancestorPaths(file.path))),
      }));
    }, () => { /* The legacy snapshot remains a usable fallback. */ });
    return () => { active = false; };
  }, [connectionState, rpc, threadId, updateState]);

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
    let active = true;
    rpc.call("prefs_get", {}).then((next) => { if (active) setPrefs(next); }, () => { /* Defaults remain valid when storage is unavailable. */ });
    return () => { active = false; };
  }, [rpc]);

  useEffect(() => {
    let active = true;
    rpc.call("workspace", { threadId, environmentId }).then((info) => { if (active) setWorkspaceInfo(info); }, () => { /* Existing tree RPC remains the fallback. */ });
    return () => { active = false; };
  }, [environmentId, rpc, threadId]);

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

  useEffect(() => {
    // Rehydrate manually opened branches after the tab returns from a native preview.
    for (const path of state.manualExpanded) {
      const parent = path.slice(0, Math.max(0, path.lastIndexOf("/")));
      const cached = state.directories.get(parent);
      if (cached?.status === "loaded" && cached.result.outcome === "available" &&
          cached.result.entries.some((entry) => entry.path === path && entry.kind === "directory")) {
        loadDirectory(path);
      }
    }
  }, [state.manualExpanded, state.directories, loadDirectory]);

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

  const isExpanded = (path: string) => state.manualExpanded.has(path) || (prefs.autoCollapse && state.autoExpanded.has(path));
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
  const statPaths = visibleRows.filter(({ entry }) => entry.kind === "file").map(({ entry }) => entry.path).sort();
  const statSignature = JSON.stringify([workspaceInfo?.rootPath ?? "", prefs.showSize, prefs.showMtime, statPaths]);
  useEffect(() => {
    if (!workspaceInfo || (!prefs.showSize && !prefs.showMtime) || statPaths.length === 0) return;
    let active = true;
    rpc.call("stats", { rootPath: workspaceInfo.rootPath, paths: statPaths.slice(0, 500) }).then((result) => {
      if (active) setFileStats(new Map(result.entries.map((entry) => [entry.path, { size: entry.size, mtimeMs: entry.mtimeMs }])));
    }, () => { /* Stats are optional decoration. */ });
    return () => { active = false; };
  }, [rpc, statSignature]);
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

  const updatePrefs = (change: Partial<ExplorerPrefs>) => {
    const next = { ...prefs, ...change };
    setPrefs(next);
    rpc.call("prefs_set", next).catch(() => undefined);
  };

  const refreshTree = () => {
    loadDirectory("", true);
    rpc.call("workspace", { threadId, environmentId }).then(setWorkspaceInfo, () => undefined);
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
    const { entries: listedEntries, truncated } = cached.result;
    const entries = [...listedEntries];
    for (const [ghostPath, marker] of state.status) {
      if (marker.deletedAt === null || ghostPath.slice(0, Math.max(0, ghostPath.lastIndexOf("/"))) !== path || entries.some((entry) => entry.path === ghostPath)) continue;
      entries.push({ path: ghostPath, name: ghostPath.slice(ghostPath.lastIndexOf("/") + 1), kind: "file", gitState: "deleted" });
    }
    return <>
      {cached.refreshing ? <StatusMessage label={`Refreshing ${path || "files"}`}>Refreshing…</StatusMessage> : null}
      {cached.refreshError ? <div role="alert">Could not refresh {path || "files"}. <button type="button" tabIndex={path ? -1 : 0} onClick={() => loadDirectory(path, true)}>Retry refresh</button></div> : null}
      {entries.length === 0 ? <StatusMessage>No files found.</StatusMessage> : entries.map((entry) => {
        const isDirectory = entry.kind === "directory";
        const expanded = isExpanded(entry.path);
        const selected = state.selectedPath === entry.path;
        const children = state.directories.get(entry.path);
        const failed = children?.status === "error" || (children?.status === "loaded" && (children.result.outcome === "unavailable" || children.refreshError));
        const activity = state.activity.get(entry.path);
        const activityAge = activity === undefined ? Infinity : now - activity.atMs;
        const activityClass = activity === undefined ? "" : activityAge <= 20_000
          ? `file-tree-activity-${activity.kind}-shimmer`
          : activityAge <= 30_000 ? `file-tree-activity-${activity.kind}` : "";
        const displayName = prefs.showFullPath ? entry.path : entry.name;
        const marker = state.status.get(entry.path);
        const markerClass = marker?.deletedAt !== null && marker?.deletedAt !== undefined ? "file-tree-status-deleted" : marker?.addedAt !== null && marker?.addedAt !== undefined ? "file-tree-status-added" : "";
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
            entry.additions || entry.deletions ? `Diff: +${entry.additions ?? 0}, -${entry.deletions ?? 0}.` : "",
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
            {prefs.useNerdFontIcons
              ? <span aria-hidden="true" className={`file-tree-glyph ${activityClass}`}>{entryGlyph(entry, expanded)}</span>
              : <Icon name={entryIcon(entry, expanded)} fallback="File" aria-hidden="true" className={`file-tree-icon ${activityClass}`} />}
            <span className={`file-tree-name ${activityClass} ${markerClass}`}>{displayName}</span>
            {entry.gitState && entry.gitState !== "clean" ? <span aria-hidden="true" data-git={entry.gitState} title={`Git: ${gitStateLabels[entry.gitState]}`} className="file-tree-git-state">{gitMarkers[entry.gitState]}</span> : null}
            {prefs.showDiff && (entry.additions || entry.deletions) ? <span className="file-tree-diff-stats" aria-hidden="true" title={`Diff: +${entry.additions ?? 0}, -${entry.deletions ?? 0}`}>
              <span className="file-tree-additions">+{entry.additions ?? 0}</span>
              <span className="file-tree-deletions">−{entry.deletions ?? 0}</span>
            </span> : null}
            {prefs.showSize && fileStats.get(entry.path)?.size !== null && fileStats.get(entry.path)?.size !== undefined ? <span className="file-tree-file-stat">{formatSize(fileStats.get(entry.path)!.size!)}</span> : null}
            {prefs.showMtime && fileStats.get(entry.path)?.mtimeMs !== null && fileStats.get(entry.path)?.mtimeMs !== undefined ? <span className="file-tree-file-stat" title={new Date(fileStats.get(entry.path)!.mtimeMs!).toLocaleString("de-DE")}>{formatMtime(fileStats.get(entry.path)!.mtimeMs!)}</span> : null}
          </button>
          {isDirectory && expanded ? <div role="group">{renderDirectory(entry.path, depth + 1)}</div> : null}
        </div>;
      })}
      {truncated ? <StatusMessage>Showing the first 10,000 paths.</StatusMessage> : null}
    </>;
  }

  const themeStyle = {
    "--filetree-read": prefs.readColor,
    "--filetree-write": prefs.writeColor,
    "--filetree-added": prefs.addedColor,
    "--filetree-deleted": prefs.deletedColor,
    "--filetree-modified": prefs.modifiedColor,
    "--filetree-diff-add": prefs.diffAddColor,
    "--filetree-diff-delete": prefs.diffDeleteColor,
  } as CSSProperties;
  return <div className="dynamic-file-tree" style={themeStyle}>
    <style>{explorerStyles}</style>
    <header className="file-tree-header">
      <div className="file-tree-header-title"><Icon name="DynamicFileTreeIcon" fallback="Folder" aria-hidden="true" className="file-tree-icon" /> <span>Filetree</span> <span className="file-tree-header-count">{visibleRows.length} items</span>{workspaceInfo?.branchName ? <span className="file-tree-branch">{workspaceInfo.branchName}</span> : null}</div>
      <span className="file-tree-header-spacer" />
      <button type="button" tabIndex={-1} className="file-tree-header-button" aria-label="Refresh filetree" title="Refresh filetree" onClick={refreshTree}>
        <Icon name="DynamicRefreshIcon" fallback="RefreshCw" aria-hidden="true" />
      </button>
      <button type="button" tabIndex={-1} className="file-tree-header-button" aria-label="Filetree settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}>
        <Icon name="DynamicSettingsIcon" fallback="Settings" aria-hidden="true" />
      </button>
    </header>
    {settingsOpen ? <div className="file-tree-settings" role="dialog" aria-label="Filetree settings">
      <label className="file-tree-setting"><input type="checkbox" checked={prefs.showDiff} onChange={(event) => updatePrefs({ showDiff: event.target.checked })} /> Diff +/−</label>
      <label className="file-tree-setting"><input type="checkbox" checked={prefs.showSize} onChange={(event) => updatePrefs({ showSize: event.target.checked })} /> Größe</label>
      <label className="file-tree-setting"><input type="checkbox" checked={prefs.showMtime} onChange={(event) => updatePrefs({ showMtime: event.target.checked })} /> Zuletzt geändert</label>
      <label className="file-tree-setting"><input type="checkbox" checked={prefs.showFullPath} onChange={(event) => updatePrefs({ showFullPath: event.target.checked })} /> Voller Pfad</label>
      <label className="file-tree-setting"><input type="checkbox" checked={prefs.useNerdFontIcons} onChange={(event) => updatePrefs({ useNerdFontIcons: event.target.checked })} /> Nerd-Font-Icons</label>
      <label className="file-tree-setting"><input type="checkbox" checked={prefs.autoCollapse} onChange={(event) => updatePrefs({ autoCollapse: event.target.checked })} /> Auto-Zuklappen</label>
      <div className="file-tree-settings-divider" />
      <div className="file-tree-settings-label">Farben</div>
      <label className="file-tree-color-setting">Lesen <input aria-label="Farbe für Lesen" type="color" value={prefs.readColor} onChange={(event) => updatePrefs({ readColor: event.target.value })} /></label>
      <label className="file-tree-color-setting">Schreiben <input aria-label="Farbe für Schreiben" type="color" value={prefs.writeColor} onChange={(event) => updatePrefs({ writeColor: event.target.value })} /></label>
      <label className="file-tree-color-setting">Hinzugefügt <input aria-label="Farbe für hinzugefügte Dateien" type="color" value={prefs.addedColor} onChange={(event) => updatePrefs({ addedColor: event.target.value })} /></label>
      <label className="file-tree-color-setting">Gelöscht <input aria-label="Farbe für gelöschte Dateien" type="color" value={prefs.deletedColor} onChange={(event) => updatePrefs({ deletedColor: event.target.value })} /></label>
      <label className="file-tree-color-setting">Geändert <input aria-label="Farbe für geänderte Dateien" type="color" value={prefs.modifiedColor} onChange={(event) => updatePrefs({ modifiedColor: event.target.value })} /></label>
      <label className="file-tree-color-setting">Diff + <input aria-label="Farbe für Diff-Zunahmen" type="color" value={prefs.diffAddColor} onChange={(event) => updatePrefs({ diffAddColor: event.target.value })} /></label>
      <label className="file-tree-color-setting">Diff − <input aria-label="Farbe für Diff-Abnahmen" type="color" value={prefs.diffDeleteColor} onChange={(event) => updatePrefs({ diffDeleteColor: event.target.value })} /></label>
    </div> : null}
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
