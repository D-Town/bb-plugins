import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createServerData } from "./server-data";

const environment = {
  id: "env_1",
  hostId: "host_1",
  path: "/workspace/project",
  isGitRepo: true,
  status: "ready",
} as never;

describe("createServerData", () => {
  it("lists an environment-scoped tree and maps Git changes", async () => {
    const { bb } = createFakePluginHost({
      sdk: {
        environments: { get: async () => environment },
        files: {
          listPaths: async () => ({
            paths: [
              { kind: "directory", name: "src", path: "src", positions: [], score: 0 },
              { kind: "file", name: "app.ts", path: "src/app.ts", positions: [], score: 0 },
            ],
            truncated: false,
          }),
        },
        plugins: {
          callRpc: async () => ({
            outcome: "available",
            files: [
              {
                path: "src/app.ts",
                previousPath: null,
                changeKind: "modified",
                additions: 1,
                deletions: 0,
                binary: false,
                origin: "tracked",
                loadMode: "auto",
                revision: "rev_1",
              },
            ],
            truncated: false,
            shortstat: "1 file changed",
            mergeBaseRef: null,
            initialPatches: [],
          }),
        },
      },
    });

    const result = await createServerData(bb).listTree({
      environmentId: "env_1",
      includeHidden: false,
    });

    expect(result).toEqual({
      outcome: "available",
      truncated: false,
      entries: [
        {
          path: "src",
          name: "src",
          kind: "directory",
          children: [
            {
              path: "src/app.ts",
              name: "app.ts",
              kind: "file",
              gitState: "modified",
            },
          ],
        },
      ],
    });
  });

  it("returns a no-environment result when the workspace has no path", async () => {
    const { bb } = createFakePluginHost({
      sdk: {
        environments: {
          get: async () => ({
            id: "env_1",
            hostId: "host_1",
            path: null,
            isGitRepo: true,
            status: "ready",
          } as never),
        },
      },
    });

    await expect(
      createServerData(bb).listTree({ environmentId: "env_1", includeHidden: false }),
    ).resolves.toEqual({
        outcome: "unavailable",
        reason: "no_workspace",
      });
  });
});
