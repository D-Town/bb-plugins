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
  app.slots.experimental_appOverlay({ id: "dynamic-file-tree-auto-open", component: DynamicFileTreeAutoOpen });
  app.slots.experimental_tab({
    id: "dynamic-file-tree",
    title: "Dynamic File Tree",
    icon: "FolderTree",
    availability: "fixed",
    context: { kind: "thread" },
    layout: "flush",
    component: DynamicFileTreeTab,
  });
});
