import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { definePluginApp, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { ExperimentalThreadContextCardProps } from "@get-bb/plugin-sdk/app";
import { rpcContract, type ListTreeOutput } from "./src/contracts";
import { FileTreeView } from "./src/components/FileTreeSection";

function StatusMessage({ children }: { children: ReactNode }) {
  return (
    <div role="status" style={{ padding: "8px 4px", fontSize: 12, opacity: 0.75 }}>
      {children}
    </div>
  );
}

export function FileTreeSection({
  environment,
}: ExperimentalThreadContextCardProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [result, setResult] = useState<ListTreeOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setResult(null);
    setError(null);

    if (environment === null) {
      return () => {
        active = false;
      };
    }

    rpc
      .call("tree_list", {
        environmentId: environment.id,
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
  }, [environment, rpc]);

  if (environment === null) return <StatusMessage>No active workspace.</StatusMessage>;
  if (error !== null) return <div role="alert">Could not load files: {error}</div>;
  if (result === null) return <StatusMessage>Loading files…</StatusMessage>;
  if (result.outcome === "unavailable") {
    return (
      <StatusMessage>
        {result.reason === "no_workspace"
          ? "This thread has no workspace."
          : "The workspace is currently unavailable."}
      </StatusMessage>
    );
  }

  return (
    <div style={{ minWidth: 0 }}>
      <FileTreeView
        entries={result.entries}
        onSelect={(path) => {
          navigate.experimental_openFilePreview({
            target: { kind: "workspace", environmentId: environment.id, path },
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

export default definePluginApp((app) => {
  app.slots.experimental_threadContextCardSection({
    id: "dynamic-file-tree",
    title: "Files",
    group: "2_changes",
    order: 50,
    component: FileTreeSection,
  });
});
