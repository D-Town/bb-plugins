// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { rpcContract } from "./contracts";

describe("Dynamic File Tree app", () => {
  it("registers a section in the thread context card", async () => {
    const captured = await loadPluginApp(() => import("../app"));

    expect(captured.threadContextCardSections).toHaveLength(1);
    expect(captured.threadContextCardSections[0]).toMatchObject({
      id: "dynamic-file-tree",
      title: "Files",
      group: "2_changes",
    });
  });

  it("opens a selected workspace file in BB preview", async () => {
    const captured = await loadPluginApp(() => import("../app"));
    const section = captured.threadContextCardSections[0];
    const rendered = renderSlot(
      section,
      {
        threadId: "thread_1",
        projectId: "project_1",
        environment: { id: "env_1" },
      },
      {
        experimental_rpcContract: rpcContract,
        rpc: {
          tree_list: async () => ({
            outcome: "available",
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
  });
});
