// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { useLayoutEffect } from "react";
import type { ExperimentalTabRegistration, ExperimentalThreadTabProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { rpcContract } from "./contracts";

afterEach(cleanup);

async function loadFixedThreadTab() {
  const captured = await loadPluginApp(() => import("../app"));
  const tab = captured.tabs.find(
    (tab): tab is Extract<ExperimentalTabRegistration, {
      availability: "fixed";
      context: { kind: "thread" };
    }> => tab.availability === "fixed" && tab.context.kind === "thread",
  );
  if (!tab) throw new Error("Expected a fixed thread tab");
  return tab;
}

describe("Dynamic File Tree app", () => {
  it("registers a fixed thread tab without a Thread Info section", async () => {
    const captured = await loadPluginApp(() => import("../app"));

    expect(captured.tabs).toHaveLength(1);
    expect(captured.tabs[0]).toMatchObject({
      id: "dynamic-file-tree",
      title: "Dynamic File Tree",
      icon: "DynamicFileTreeIcon",
      availability: "fixed",
      context: { kind: "thread" },
      layout: "flush",
    });
    expect(captured.threadInfoSections).toHaveLength(0);
  });

  it("shows the no-environment state without fetching files", async () => {
    const tab = await loadFixedThreadTab();
    const rendered = renderSlot(tab, {
      threadId: "thread_1",
      environment: null,
    });

    expect(rendered.getByRole("status").textContent).toBe("No active workspace.");
    expect(rendered.inspection.rpcCalls).toEqual([]);
  });

  it("shows loading while the environment tree is pending", async () => {
    const tab = await loadFixedThreadTab();
    const rendered = renderSlot(
      tab,
      { threadId: "thread_1", environment: { id: "env_1" } },
      {
        experimental_rpcContract: rpcContract,
        rpc: { tree_list: () => new Promise(() => {}) },
      },
    );

    expect(rendered.getByRole("status").textContent).toBe("Loading files…");
  });

  it.each([
    { threadId: "thread_2", environment: { id: "env_1" } },
    { threadId: "thread_1", environment: { id: "env_2" } },
    { threadId: "thread_2", environment: { id: "env_2" } },
  ])("hides the previous tree before effects on a switch to $threadId/$environment.id", async (nextContext) => {
    const tab = await loadFixedThreadTab();
    const Tab = tab.component;
    const staleFilesAtCommit: boolean[] = [];
    function ObservedTab(props: ExperimentalThreadTabProps) {
      useLayoutEffect(() => {
        if (props.threadId === nextContext.threadId && props.environment?.id === nextContext.environment.id) {
          // Observe and try selection before the tab's passive reset effect runs.
          const staleFile = document.querySelector<HTMLButtonElement>('button[aria-label="old.md"]');
          staleFilesAtCommit.push(staleFile !== null);
          staleFile?.click();
        }
      }, [props.threadId, props.environment?.id]);
      return <Tab {...props} />;
    }
    let calls = 0;
    const rendered = renderSlot(
      { ...tab, component: ObservedTab },
      { threadId: "thread_1", environment: { id: "env_1" } },
      {
        experimental_rpcContract: rpcContract,
        rpc: {
          tree_list: () => ++calls === 1
            ? Promise.resolve({
              outcome: "available" as const,
              directory: "",
              gitAvailable: "available" as const,
              truncated: false,
              entries: [{ path: "old.md", name: "old.md", kind: "file" as const }],
            })
            : new Promise(() => {}),
        },
      },
    );
    await rendered.findByRole("button", { name: "old.md" });

    rendered.lifecycle.rerender(<ObservedTab {...nextContext} />);

    expect(staleFilesAtCommit).toEqual([false]);
    expect(rendered.queryByRole("button", { name: "old.md" })).toBeNull();
    expect(rendered.getByRole("status").textContent).toBe("Loading files…");
    expect(rendered.inspection.navigateCalls).toEqual([]);
  });

  it("opens a selected workspace file in BB preview", async () => {
    const tab = await loadFixedThreadTab();
    const rendered = renderSlot(
      tab,
      {
        threadId: "thread_1",
        environment: { id: "env_1" },
      },
      {
        openFilePreview: () => true,
        experimental_rpcContract: rpcContract,
        rpc: {
          tree_list: async () => ({
            outcome: "available",
            directory: "",
            gitAvailable: "available",
            truncated: false,
            entries: [
              {
                path: "README.md",
                name: "README.md",
                kind: "file",
              },
            ],
          }),
        },
      },
    );

    const file = await rendered.findByRole("button", { name: "README.md" });
    file.click();

    expect(rendered.inspection.navigateCalls).toContainEqual({
      method: "experimental_openFilePreview",
      options: {
        target: { kind: "workspace", environmentId: "env_1", path: "README.md" },
        location: null,
      },
    });
    expect(rendered.inspection.rpcCalls.some((call) => call.method === "file_preview")).toBe(false);
  });
});

describe("activity_snapshot contract", () => {
  it("accepts all activity kinds and BB row statuses", () => {
    const activities = [
      { activityId: "a1", path: "src/app.ts", kind: "read", status: "completed" },
      { activityId: "a2", path: "src/app.ts", kind: "write", status: "error" },
      { activityId: "a3", path: "src", kind: "search", status: "interrupted" },
      { activityId: "a4", path: ".", kind: "list", status: "pending" },
    ];

    expect(rpcContract.activity_snapshot.input.parse({ threadId: "thread_1" }))
      .toEqual({ threadId: "thread_1" });
    expect(rpcContract.activity_snapshot.output.parse({ available: true, activities }))
      .toEqual({ available: true, activities });
    expect(rpcContract.activity_snapshot.output.parse({ available: false, activities: [] }))
      .toEqual({ available: false, activities: [] });
  });

  it("rejects an empty thread id and unsupported activity kinds or statuses", () => {
    expect(rpcContract.activity_snapshot.input.safeParse({ threadId: "" }).success).toBe(false);
    for (const activity of [
      { activityId: "a1", path: "src/app.ts", kind: "execute", status: "pending" },
      { activityId: "a1", path: "src/app.ts", kind: "read", status: "running" },
    ]) {
      expect(rpcContract.activity_snapshot.output.safeParse({
        available: true, activities: [activity],
      }).success).toBe(false);
    }
  });
});
