import { useEffect } from "react";
import { definePluginApp, experimental_useAppPanel, useBbContext } from "@get-bb/plugin-sdk/app";
import type { ExperimentalThreadTabProps } from "@get-bb/plugin-sdk/app";
import { FileTreeView } from "./src/components/FileTreeSection";

export function DynamicFileTreeTab(props: ExperimentalThreadTabProps) {
  return (
    <div style={{ height: "100%", minHeight: 0, minWidth: 0, overflow: "auto" }}>
      <FileTreeView {...props} />
    </div>
  );
}

function DynamicFileTreeIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 5h6l2 2h8v12H4z" /><path d="M8 11v5M8 13h4M8 16h8" />
  </svg>;
}

function DynamicSettingsIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /><circle cx="12" cy="12" r="3.5" /><circle cx="12" cy="12" r="8" />
  </svg>;
}

function DynamicRefreshIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 11a8 8 0 0 0-14.7-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14.7 4L20 15M20 20v-5h-5" />
  </svg>;
}

const autoOpenedThreads = new Set<string>();
function DynamicFileTreeAutoOpen() {
  const { threadId } = useBbContext();
  const panel = experimental_useAppPanel();
  useEffect(() => {
    if (!threadId || autoOpenedThreads.has(threadId)) return;
    autoOpenedThreads.add(threadId);
    panel.openTab({ tab: { id: "dynamic-file-tree", context: { kind: "thread" }, availability: "fixed" } });
  }, [panel, threadId]);
  return null;
}

export default definePluginApp((app) => {
  app.experimental_icons.register({ name: "DynamicFileTreeIcon", component: DynamicFileTreeIcon });
  app.experimental_icons.register({ name: "DynamicSettingsIcon", component: DynamicSettingsIcon });
  app.experimental_icons.register({ name: "DynamicRefreshIcon", component: DynamicRefreshIcon });
  app.slots.experimental_appOverlay({ id: "dynamic-file-tree-auto-open", component: DynamicFileTreeAutoOpen });
  app.slots.experimental_tab({
    id: "dynamic-file-tree",
    title: "Dynamic File Tree",
    icon: "DynamicFileTreeIcon",
    availability: "fixed",
    context: { kind: "thread" },
    layout: "flush",
    component: DynamicFileTreeTab,
  });
});
