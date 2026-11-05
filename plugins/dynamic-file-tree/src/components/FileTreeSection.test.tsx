// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PluginRealtimeConnectionState } from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import { DynamicFileTreeTab } from "../../app";
import { collectActiveActivities } from "../activity-model";
import { rpcContract } from "../contracts";
import type { ActivePathActivity, ActivitySnapshotOutput, ListTreeInput, ListTreeOutput, TreeEntry } from "../contracts";

afterEach(cleanup);

const context = { threadId: "thread_1", environment: { id: "env_1" } };
const directory = (path: string): TreeEntry => ({ path, name: path.split("/").at(-1)!, kind: "directory", hasChildren: true });
const file = (path: string): TreeEntry => ({ path, name: path.split("/").at(-1)!, kind: "file" });
const listings: Record<string, TreeEntry[]> = {
  "": [directory("src"), directory("docs"), file(".gitignore")],
  src: [directory("src/components"), directory("src/utils"), file("src/app.ts")],
  "src/components": [file("src/components/Button.tsx")],
  "src/utils": [file("src/utils/path.ts")],
  docs: [file("docs/guide.md")],
};
function available(path: string, entries = listings[path] ?? []): ListTreeOutput {
  return { outcome: "available", directory: path, entries, gitAvailable: "available", truncated: false };
}
function pending(path: string, activityId = path): ActivePathActivity {
  return { activityId, path, kind: "read", status: "pending" };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function mount(handlers: Partial<PluginRpcTestHandlers<typeof rpcContract>> = {}, realtimeConnectionState: PluginRealtimeConnectionState = "connected") {
  return renderSlot<typeof context, typeof rpcContract>({ component: DynamicFileTreeTab }, context, {
    experimental_rpcContract: rpcContract,
    realtimeConnectionState,
    // The unrelated global selection must never supply the explorer's scope.
    context: { threadId: "other_thread", projectId: "other_project" },
    rpc: {
      tree_list: async ({ path }) => available(path ?? ""),
      activity_snapshot: async () => ({ available: true, activities: [] }),
      ...handlers,
    },
  });
}
function requests(view: ReturnType<typeof mount>) {
  return view.inspection.rpcCalls.filter((call) => call.method === "tree_list").map((call) => call.input as ListTreeInput);
}
async function update(view: ReturnType<typeof mount>, activities: ActivePathActivity[], sequence = 1, available = true, threadId = "thread_1") {
  await view.behavior.emitRealtime("activity-updated", { threadId, sequence, available, activities });
}

describe("fixed-tab file explorer", () => {
  it("loads the scoped root with initially collapsed directories and visible dotfiles", async () => {
    const view = mount();
    const src = await view.findByRole("button", { name: "src" });
    expect(src.getAttribute("aria-expanded")).toBe("false");
    expect(view.getByRole("button", { name: ".gitignore" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "app.ts" })).toBeNull();
    expect(requests(view)).toEqual([{ environmentId: "env_1", path: "" }]);
    expect(view.inspection.rpcCalls).toContainEqual({ method: "activity_snapshot", input: { threadId: "thread_1" } });
    expect(view.getAllByRole("treeitem")).toHaveLength(3);
  });

  it("loads direct children on opening and reuses them after manual close/reopen", async () => {
    const view = mount();
    const src = await view.findByRole("button", { name: "src" });
    fireEvent.click(src);
    await view.findByRole("button", { name: "app.ts" });
    expect(requests(view)).toEqual([
      { environmentId: "env_1", path: "" }, { environmentId: "env_1", path: "src" },
    ]);
    expect(view.queryByRole("button", { name: "Button.tsx" })).toBeNull();
    fireEvent.click(src);
    expect(view.queryByRole("button", { name: "app.ts" })).toBeNull();
    fireEvent.click(src);
    expect(view.getByRole("button", { name: "app.ts" })).toBeTruthy();
    expect(requests(view)).toHaveLength(2);
  });

  it("keeps child loading local and deduplicates an in-flight folder request", async () => {
    const child = deferred<ListTreeOutput>();
    const view = mount({ tree_list: ({ path }) => path === "src" ? child.promise : available(path ?? "") });
    const src = await view.findByRole("button", { name: "src" });
    fireEvent.click(src);
    expect(view.getByRole("status", { name: "Loading src" })).toBeTruthy();
    expect(view.getByRole("button", { name: ".gitignore" })).toBeTruthy();
    fireEvent.click(src);
    fireEvent.click(src);
    expect(requests(view)).toHaveLength(2);
    await act(async () => child.resolve(available("src")));
    expect(view.getByRole("button", { name: "app.ts" })).toBeTruthy();
  });

  it.each(["rejection", "unavailable"])("shows a local child %s and retries only that folder", async (failure) => {
    let attempts = 0;
    const view = mount({ tree_list: ({ path }) => {
      if (path === "src" && attempts++ === 0) {
        if (failure === "rejection") throw new Error("Permission denied");
        return { outcome: "unavailable", directory: "src", reason: "directory_unavailable" };
      }
      return available(path ?? "");
    } });
    fireEvent.click(await view.findByRole("button", { name: "src" }));
    expect((await view.findByRole("alert")).textContent).toContain("src");
    expect(view.getByRole("button", { name: "docs" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Retry src" }));
    await view.findByRole("button", { name: "app.ts" });
    expect(requests(view)).toEqual([
      { environmentId: "env_1", path: "" }, { environmentId: "env_1", path: "src" }, { environmentId: "env_1", path: "src" },
    ]);
  });

  it("selects a file and retains native workspace preview navigation", async () => {
    const view = mount();
    fireEvent.click(await view.findByRole("button", { name: ".gitignore" }));
    expect(view.getByRole("treeitem", { name: ".gitignore" }).getAttribute("aria-selected")).toBe("true");
    expect(view.inspection.navigateCalls).toEqual([{
      method: "experimental_openFilePreview",
      options: { target: { kind: "workspace", environmentId: "env_1", path: ".gitignore" }, location: null },
    }]);
  });

  it("loads only the pending file's ancestor chain from the mount snapshot", async () => {
    const view = mount({ activity_snapshot: async () => ({ available: true, activities: [pending("src/components/Button.tsx")] }) });
    await view.findByRole("button", { name: "Button.tsx" });
    expect(requests(view)).toEqual([
      { environmentId: "env_1", path: "" }, { environmentId: "env_1", path: "src" }, { environmentId: "env_1", path: "src/components" },
    ]);
    expect(view.getByRole("button", { name: "docs" }).getAttribute("aria-expanded")).toBe("false");
    expect(view.getByRole("button", { name: "utils" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("ignores activity updates for other threads", async () => {
    const view = mount();
    await view.findByRole("button", { name: "src" });
    await update(view, [pending("src/components/Button.tsx")], 1, true, "thread_2");
    expect(requests(view)).toEqual([{ environmentId: "env_1", path: "" }]);
    expect(view.getByRole("button", { name: "src" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("unions multiple pending activities and preserves shared ancestors until all finish", async () => {
    const view = mount();
    await view.findByRole("button", { name: "src" });
    await update(view, [pending("src/components/Button.tsx", "a"), pending("src/utils/path.ts", "b")]);
    await view.findByRole("button", { name: "Button.tsx" });
    await view.findByRole("button", { name: "path.ts" });
    expect(requests(view).filter((input) => input.path === "src")).toHaveLength(1);
    await update(view, [pending("src/utils/path.ts", "b")], 2);
    expect(view.queryByRole("button", { name: "Button.tsx" })).toBeNull();
    expect(view.getByRole("button", { name: "path.ts" })).toBeTruthy();
    expect(view.getByRole("button", { name: "src" }).getAttribute("aria-expanded")).toBe("true");
    await update(view, [], 3);
    expect(view.getByRole("button", { name: "src" }).getAttribute("aria-expanded")).toBe("false");
  });

  it.each(["completed", "error", "interrupted"] as const)("clears automatic expansion for %s activity", async (status) => {
    const view = mount();
    await view.findByRole("button", { name: "src" });
    await update(view, [pending("src/components/Button.tsx")]);
    await view.findByRole("button", { name: "Button.tsx" });
    await update(view, [{ ...pending("src/components/Button.tsx"), status }], 2);
    expect(view.getByRole("button", { name: "src" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("preserves manual expansion through empty and unavailable activity updates", async () => {
    const view = mount();
    fireEvent.click(await view.findByRole("button", { name: "src" }));
    await view.findByRole("button", { name: "app.ts" });
    await update(view, [pending("src/components/Button.tsx")]);
    await view.findByRole("button", { name: "Button.tsx" });
    await update(view, [], 2);
    expect(view.getByRole("button", { name: "app.ts" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Button.tsx" })).toBeNull();
    await update(view, [pending("src/components/Button.tsx")], 3);
    await update(view, [], 4, false);
    expect(view.getByRole("button", { name: "app.ts" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Button.tsx" })).toBeNull();
  });

  it("changes only manual expansion when a user clicks an automatically open folder", async () => {
    const view = mount();
    await view.findByRole("button", { name: "src" });
    await update(view, [pending("src/components/Button.tsx")]);
    await view.findByRole("button", { name: "Button.tsx" });
    fireEvent.click(view.getByRole("button", { name: "src" }));
    await update(view, [], 2);
    expect(view.getByRole("button", { name: "app.ts" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "src" }));
    expect(view.queryByRole("button", { name: "app.ts" })).toBeNull();
  });

  it("does not expand anything for a pathless command", async () => {
    const activities = collectActiveActivities([{
      id: "cmd_1", kind: "work", workKind: "command", status: "pending", command: "npm test",
      activityIntents: [{ type: "read", path: null }],
    }]);
    const view = mount();
    await view.findByRole("button", { name: "src" });
    await update(view, activities);
    expect(view.getByRole("button", { name: "src" }).getAttribute("aria-expanded")).toBe("false");
    expect(requests(view)).toHaveLength(1);
  });

  it("remains manually usable if the activity snapshot fails", async () => {
    const view = mount({ activity_snapshot: async () => { throw new Error("Timeline unavailable"); } });
    fireEvent.click(await view.findByRole("button", { name: "src" }));
    await view.findByRole("button", { name: "app.ts" });
    expect(view.queryByRole("alert")).toBeNull();
    await update(view, [pending("src/components/Button.tsx")]);
    await view.findByRole("button", { name: "Button.tsx" });
  });

  it("does not overwrite a newer realtime update with a late mount snapshot", async () => {
    const snapshot = deferred<ActivitySnapshotOutput>();
    const view = mount({ activity_snapshot: () => snapshot.promise });
    await view.findByRole("button", { name: "src" });
    await update(view, [pending("src/components/Button.tsx")], 5);
    await view.findByRole("button", { name: "Button.tsx" });
    await act(async () => snapshot.resolve({ available: true, activities: [] }));
    expect(view.getByRole("button", { name: "Button.tsx" })).toBeTruthy();
    await update(view, [], 4);
    expect(view.getByRole("button", { name: "Button.tsx" })).toBeTruthy();
  });

  it.each([
    { threadId: "thread_2", environment: { id: "env_1" } },
    { threadId: "thread_1", environment: { id: "env_2" } },
  ])("resets cache, expansion, selection and pending responses on context change to $threadId/$environment.id", async (nextContext) => {
    const oldChild = deferred<ListTreeOutput>();
    let roots = 0;
    const view = mount({ tree_list: ({ path }) => {
      if (path === "") return available("", ++roots === 1 ? listings[""] : [directory("src"), file("new.md")]);
      return oldChild.promise;
    } });
    fireEvent.click(await view.findByRole("button", { name: ".gitignore" }));
    fireEvent.click(view.getByRole("button", { name: "src" }));
    view.lifecycle.rerender(<DynamicFileTreeTab {...nextContext} />);
    await view.findByRole("button", { name: "new.md" });
    await act(async () => oldChild.resolve(available("src")));
    expect(view.getByRole("button", { name: "src" }).getAttribute("aria-expanded")).toBe("false");
    expect(view.queryByRole("button", { name: "app.ts" })).toBeNull();
    expect(view.queryByRole("treeitem", { selected: true })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "src" }));
    await waitFor(() => expect(requests(view).at(-1)).toEqual({ environmentId: nextContext.environment.id, path: "src" }));
    await view.findByRole("button", { name: "app.ts" });
  });
});

describe("activity connection recovery", () => {
  it.each(["connecting", "reconnecting"] as const)("clears only automatic expansion while %s and ignores disconnected signals", async (connection) => {
    const view = mount();
    fireEvent.click(await view.findByRole("button", { name: "docs" }));
    fireEvent.click(await view.findByRole("button", { name: "guide.md" }));
    await update(view, [pending("src/components/Button.tsx")], 10);
    await view.findByRole("button", { name: "Button.tsx" });

    await view.behavior.setRealtimeConnectionState(connection);

    expect(view.getByRole("button", { name: "src" }).getAttribute("aria-expanded")).toBe("false");
    expect(view.getByRole("button", { name: "guide.md" })).toBeTruthy();
    expect(view.getByRole("treeitem", { name: "guide.md" }).getAttribute("aria-selected")).toBe("true");
    await update(view, [pending("src/utils/path.ts")], 11);
    expect(view.getByRole("button", { name: "src" }).getAttribute("aria-expanded")).toBe("false");
    expect(view.inspection.rpcCalls.filter((call) => call.method === "activity_snapshot")).toHaveLength(1);
    fireEvent.click(view.getByRole("button", { name: "docs" }));
    fireEvent.click(view.getByRole("button", { name: "docs" }));
    expect(view.getByRole("button", { name: "guide.md" })).toBeTruthy();
    expect(requests(view)).toEqual([
      { environmentId: "env_1", path: "" }, { environmentId: "env_1", path: "docs" },
      { environmentId: "env_1", path: "src" }, { environmentId: "env_1", path: "src/components" },
    ]);
  });

  it("reconciles a fresh snapshot on reconnect even after earlier sequenced activity", async () => {
    let snapshots = 0;
    const view = mount({ activity_snapshot: async () => ({ available: true, activities: ++snapshots === 1 ? [] : [pending("docs/guide.md")] }) });
    await view.findByRole("button", { name: "src" });
    await update(view, [pending("src/components/Button.tsx")], 10);
    await view.findByRole("button", { name: "Button.tsx" });
    await view.behavior.setRealtimeConnectionState("reconnecting");
    await view.behavior.setRealtimeConnectionState("connected");

    await view.findByRole("button", { name: "guide.md" });
    expect(view.getByRole("button", { name: "src" }).getAttribute("aria-expanded")).toBe("false");
    expect(view.inspection.rpcCalls.filter((call) => call.method === "activity_snapshot")).toEqual([
      { method: "activity_snapshot", input: { threadId: "thread_1" } },
      { method: "activity_snapshot", input: { threadId: "thread_1" } },
    ]);
    await update(view, [pending("src/utils/path.ts")], 9);
    expect(view.getByRole("button", { name: "guide.md" })).toBeTruthy();
    expect(requests(view)).toEqual([
      { environmentId: "env_1", path: "" }, { environmentId: "env_1", path: "src" },
      { environmentId: "env_1", path: "src/components" }, { environmentId: "env_1", path: "docs" },
    ]);
  });

  it("rejects a snapshot from before disconnect and protects newer realtime from reconnect snapshots", async () => {
    const oldSnapshot = deferred<ActivitySnapshotOutput>();
    const reconnectSnapshot = deferred<ActivitySnapshotOutput>();
    let snapshots = 0;
    const view = mount({ activity_snapshot: () => ++snapshots === 1 ? oldSnapshot.promise : reconnectSnapshot.promise });
    await view.findByRole("button", { name: "src" });
    await view.behavior.setRealtimeConnectionState("reconnecting");
    await act(async () => oldSnapshot.resolve({ available: true, activities: [pending("src/components/Button.tsx")] }));
    expect(view.getByRole("button", { name: "src" }).getAttribute("aria-expanded")).toBe("false");
    await view.behavior.setRealtimeConnectionState("connected");
    await update(view, [pending("docs/guide.md")], 20);
    await view.findByRole("button", { name: "guide.md" });
    await act(async () => reconnectSnapshot.resolve({ available: true, activities: [pending("src/components/Button.tsx")] }));
    expect(view.getByRole("button", { name: "guide.md" })).toBeTruthy();
    expect(view.getByRole("button", { name: "src" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps manual folders open if reconnect reconciliation fails", async () => {
    let snapshots = 0;
    const view = mount({ activity_snapshot: async () => {
      if (++snapshots > 1) throw new Error("Unavailable");
      return { available: true, activities: [] };
    } });
    fireEvent.click(await view.findByRole("button", { name: "src" }));
    await view.findByRole("button", { name: "app.ts" });
    await update(view, [pending("src/components/Button.tsx")], 1);
    await view.findByRole("button", { name: "Button.tsx" });
    await view.behavior.setRealtimeConnectionState("reconnecting");
    await view.behavior.setRealtimeConnectionState("connected");
    expect(view.queryByRole("button", { name: "Button.tsx" })).toBeNull();
    expect(view.getByRole("button", { name: "app.ts" })).toBeTruthy();
    expect(view.inspection.rpcCalls.filter((call) => call.method === "activity_snapshot")).toHaveLength(2);
  });

  it("waits for a connected state before the initial activity snapshot", async () => {
    const view = mount({}, "connecting");
    await view.findByRole("button", { name: "src" });
    expect(view.inspection.rpcCalls.filter((call) => call.method === "activity_snapshot")).toHaveLength(0);
    await view.behavior.setRealtimeConnectionState("connected");
    expect(view.inspection.rpcCalls.filter((call) => call.method === "activity_snapshot")).toHaveLength(1);
  });
});

function focusRow(row: HTMLElement) {
  act(() => row.focus());
}
function press(key: string) {
  fireEvent.keyDown(document.activeElement!, { key });
}

describe("treeview keyboard interaction", () => {
  it("collapses an automatically expanded folder with ArrowLeft", async () => {
    const view = mount();
    await view.findByRole("treeitem", { name: "src" });
    await update(view, [pending("src/components/Button.tsx")]);
    await view.findByRole("treeitem", { name: "Button.tsx" });
    const src = view.getByRole("treeitem", { name: "src" });
    focusRow(src);
    press("ArrowLeft");
    expect(src.getAttribute("aria-expanded")).toBe("false");
    expect(view.queryByRole("treeitem", { name: "Button.tsx" })).toBeNull();
    expect(document.activeElement).toBe(src);
    press("ArrowRight");
    expect(view.getByRole("treeitem", { name: "Button.tsx" })).toBeTruthy();
    expect(requests(view)).toEqual([
      { environmentId: "env_1", path: "" }, { environmentId: "env_1", path: "src" },
      { environmentId: "env_1", path: "src/components" },
    ]);
  });

  it("retries a failed folder with ArrowRight without adding another tab stop", async () => {
    let attempts = 0;
    const view = mount({ tree_list: ({ path }) => {
      if (path === "src" && attempts++ === 0) throw new Error("Unavailable");
      return available(path ?? "");
    } });
    const src = await view.findByRole("treeitem", { name: "src" });
    focusRow(src);
    press("ArrowRight");
    await view.findByRole("alert");
    expect(view.getByRole("button", { name: "Retry src" }).tabIndex).toBe(-1);
    expect(src.getAttribute("aria-description")).toContain("ArrowRight");
    press("ArrowRight");
    await view.findByRole("treeitem", { name: "components" });
    expect(document.activeElement).toBe(src);
    expect(requests(view)).toEqual([
      { environmentId: "env_1", path: "" }, { environmentId: "env_1", path: "src" },
      { environmentId: "env_1", path: "src" },
    ]);
  });

  it("does not steal focus from outside the tree when activity removes the previous row", async () => {
    const view = mount();
    await view.findByRole("treeitem", { name: "src" });
    await update(view, [pending("src/components/Button.tsx")]);
    focusRow(await view.findByRole("treeitem", { name: "Button.tsx" }));
    const outside = document.createElement("button");
    document.body.append(outside);
    try {
      focusRow(outside);
      await update(view, [], 2);
      expect(document.activeElement).toBe(outside);
      expect(view.getByRole("treeitem", { name: "src" }).tabIndex).toBe(0);
    } finally {
      outside.remove();
    }
  });

  it("provides one roving treeitem tab stop and keeps row buttons out of the tab order", async () => {
    const view = mount();
    const src = await view.findByRole("treeitem", { name: "src" });
    expect(view.getAllByRole("treeitem").map((row) => row.tabIndex)).toEqual([0, -1, -1]);
    expect(view.getAllByRole("button").every((button) => button.tabIndex === -1)).toBe(true);
    focusRow(src);
    press("ArrowDown");
    const docs = view.getByRole("treeitem", { name: "docs" });
    expect(document.activeElement).toBe(docs);
    expect(view.getAllByRole("treeitem").map((row) => row.tabIndex)).toEqual([-1, 0, -1]);
    expect(requests(view)).toEqual([{ environmentId: "env_1", path: "" }]);
  });

  it("ArrowRight opens lazily, waits for children, then enters the first child without extra requests", async () => {
    const children = deferred<ListTreeOutput>();
    const view = mount({ tree_list: ({ path }) => path === "src" ? children.promise : available(path ?? "") });
    const src = await view.findByRole("treeitem", { name: "src" });
    focusRow(src);
    press("ArrowRight");
    expect(src.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(src);
    expect(requests(view)).toEqual([{ environmentId: "env_1", path: "" }, { environmentId: "env_1", path: "src" }]);
    press("ArrowRight");
    expect(document.activeElement).toBe(src);
    expect(requests(view)).toHaveLength(2);
    await act(async () => children.resolve(available("src")));
    press("ArrowRight");
    const components = view.getByRole("treeitem", { name: "components" });
    expect(document.activeElement).toBe(components);
    expect(components.getAttribute("aria-expanded")).toBe("false");
    expect(requests(view)).toHaveLength(2);
    press("ArrowRight");
    await view.findByRole("treeitem", { name: "Button.tsx" });
    expect(document.activeElement).toBe(components);
    press("ArrowRight");
    const button = view.getByRole("treeitem", { name: "Button.tsx" });
    expect(document.activeElement).toBe(button);
    press("ArrowRight");
    expect(document.activeElement).toBe(button);
    expect(requests(view)).toEqual([
      { environmentId: "env_1", path: "" }, { environmentId: "env_1", path: "src" }, { environmentId: "env_1", path: "src/components" },
    ]);
    expect(view.inspection.navigateCalls).toEqual([]);
  });

  it("ArrowLeft moves from a leaf or closed child to its parent and collapses an open folder", async () => {
    const view = mount();
    const src = await view.findByRole("treeitem", { name: "src" });
    focusRow(src);
    press("ArrowRight");
    await view.findByRole("treeitem", { name: "components" });
    press("ArrowRight");
    press("ArrowLeft");
    expect(document.activeElement).toBe(src);
    expect(src.getAttribute("aria-expanded")).toBe("true");
    press("ArrowRight");
    press("ArrowRight");
    await view.findByRole("treeitem", { name: "Button.tsx" });
    press("ArrowRight");
    press("ArrowLeft");
    const components = view.getByRole("treeitem", { name: "components" });
    expect(document.activeElement).toBe(components);
    expect(components.getAttribute("aria-expanded")).toBe("true");
    press("ArrowLeft");
    expect(components.getAttribute("aria-expanded")).toBe("false");
    expect(view.queryByRole("treeitem", { name: "Button.tsx" })).toBeNull();
    press("ArrowLeft");
    expect(document.activeElement).toBe(src);
    press("ArrowLeft");
    expect(src.getAttribute("aria-expanded")).toBe("false");
    expect(view.queryByRole("treeitem", { name: "components" })).toBeNull();
    press("ArrowLeft");
    expect(document.activeElement).toBe(src);
    expect(requests(view)).toEqual([
      { environmentId: "env_1", path: "" }, { environmentId: "env_1", path: "src" }, { environmentId: "env_1", path: "src/components" },
    ]);
  });

  it("navigates only visible rows with Up/Down and Home/End without loading or activating files", async () => {
    const view = mount();
    fireEvent.click(await view.findByRole("button", { name: "src" }));
    await view.findByRole("treeitem", { name: "components" });
    focusRow(view.getByRole("treeitem", { name: "src" }));
    for (const name of ["components", "utils", "app.ts", "docs", ".gitignore"]) {
      press("ArrowDown");
      expect(document.activeElement).toBe(view.getByRole("treeitem", { name }));
    }
    press("ArrowDown");
    expect(document.activeElement).toBe(view.getByRole("treeitem", { name: ".gitignore" }));
    press("ArrowUp");
    expect(document.activeElement).toBe(view.getByRole("treeitem", { name: "docs" }));
    press("Home");
    press("ArrowUp");
    expect(document.activeElement).toBe(view.getByRole("treeitem", { name: "src" }));
    press("End");
    expect(document.activeElement).toBe(view.getByRole("treeitem", { name: ".gitignore" }));
    expect(requests(view)).toEqual([{ environmentId: "env_1", path: "" }, { environmentId: "env_1", path: "src" }]);
    expect(view.inspection.navigateCalls).toEqual([]);
    expect(view.queryByRole("treeitem", { selected: true })).toBeNull();
  });

  it("activates folders and native file preview with Enter/Space while keeping focus separate from selection", async () => {
    const view = mount();
    const src = await view.findByRole("treeitem", { name: "src" });
    focusRow(src);
    press("Enter");
    await view.findByRole("treeitem", { name: "app.ts" });
    press(" ");
    expect(src.getAttribute("aria-expanded")).toBe("false");
    press("Enter");
    expect(view.getByRole("treeitem", { name: "app.ts" })).toBeTruthy();
    expect(requests(view)).toEqual([{ environmentId: "env_1", path: "" }, { environmentId: "env_1", path: "src" }]);
    press("End");
    press(" ");
    const gitignore = view.getByRole("treeitem", { name: ".gitignore" });
    expect(gitignore.getAttribute("aria-selected")).toBe("true");
    expect(view.inspection.navigateCalls).toEqual([{
      method: "experimental_openFilePreview",
      options: { target: { kind: "workspace", environmentId: "env_1", path: ".gitignore" }, location: null },
    }]);
    press("Home");
    expect(document.activeElement).toBe(src);
    expect(gitignore.getAttribute("aria-selected")).toBe("true");
  });

  it("keeps a visible ancestor focused when activity cleanup removes the focused descendant", async () => {
    const view = mount();
    await view.findByRole("treeitem", { name: "src" });
    await update(view, [pending("src/components/Button.tsx")]);
    focusRow(await view.findByRole("treeitem", { name: "Button.tsx" }));
    await update(view, [], 2);
    const src = view.getByRole("treeitem", { name: "src" });
    expect(document.activeElement).toBe(src);
    expect(src.tabIndex).toBe(0);
    expect(view.getAllByRole("treeitem").filter((row) => row.tabIndex === 0)).toHaveLength(1);
  });

  it("moves the managed focus target on row clicks and continues arrow navigation from it", async () => {
    const view = mount();
    fireEvent.click(await view.findByRole("button", { name: "docs" }));
    await view.findByRole("treeitem", { name: "guide.md" });
    expect(document.activeElement).toBe(view.getByRole("treeitem", { name: "docs" }));
    press("ArrowDown");
    expect(document.activeElement).toBe(view.getByRole("treeitem", { name: "guide.md" }));
    press("ArrowLeft");
    expect(document.activeElement).toBe(view.getByRole("treeitem", { name: "docs" }));
    expect(requests(view)).toEqual([{ environmentId: "env_1", path: "" }, { environmentId: "env_1", path: "docs" }]);
  });
});
