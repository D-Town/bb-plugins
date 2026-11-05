import { definePluginApp } from "@get-bb/plugin-sdk/app";
import type { ExperimentalThreadTabProps } from "@get-bb/plugin-sdk/app";
import { FileTreeView } from "./src/components/FileTreeSection";

export function DynamicFileTreeTab(props: ExperimentalThreadTabProps) {
  return (
    <div style={{ height: "100%", minHeight: 0, minWidth: 0, overflow: "auto" }}>
      <FileTreeView {...props} />
    </div>
  );
}

export default definePluginApp((app) => {
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
