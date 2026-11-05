import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { definePluginApp, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { ExperimentalThreadTabProps } from "@get-bb/plugin-sdk/app";
import { rpcContract, type ListTreeOutput } from "./src/contracts";
import { FileTreeView } from "./src/components/FileTreeSection";

function StatusMessage({ children }: { children: ReactNode }) {
  return (
    <div role="status" style={{ padding: "8px 4px", fontSize: 12, opacity: 0.75 }}>
      {children}
    </div>
  );
}

export function DynamicFileTreeTab(props: ExperimentalThreadTabProps) {
  const { threadId } = props;
  const environmentId = props.environment?.id;
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [result, setResult] = useState<ListTreeOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setResult(null);
    setError(null);

    if (environmentId === undefined) {
      return () => {
        active = false;
      };
    }

    rpc
      .call("tree_list", {
        environmentId,
        includeHidden: false,
      })
      .then(
        (next) => {
          if (active) setResult(next);
        },
        (cause: unknown) => {
          if (active) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        },
      );

    return () => {
      active = false;
    };
  }, [threadId, environmentId, rpc]);

  let content: ReactNode;
  if (environmentId === undefined) content = <StatusMessage>No active workspace.</StatusMessage>;
  else if (error !== null) content = <div role="alert">Could not load files: {error}</div>;
  else if (result === null) content = <StatusMessage>Loading files…</StatusMessage>;
  else if (result.outcome === "unavailable") {
    content = (
      <StatusMessage>
        {result.reason === "no_workspace"
          ? "This thread has no workspace."
          : "The workspace is currently unavailable."}
      </StatusMessage>
    );
  } else {
    content = (
      <div style={{ minWidth: 0 }}>
        <FileTreeView
          entries={result.entries}
          onSelect={(path) => {
            navigate.experimental_openFilePreview({
              target: { kind: "workspace", environmentId, path },
              location: null,
            });
          }}
        />
        {result.truncated ? (
          <StatusMessage>Showing the first 10,000 paths.</StatusMessage>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ height: "100%", minHeight: 0, minWidth: 0, overflow: "auto" }}>
      {content}
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
