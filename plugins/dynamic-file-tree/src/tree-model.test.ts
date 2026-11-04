import { describe, expect, it } from "vitest";
import { buildTree, type ListedPath } from "./tree-model";

describe("buildTree", () => {
  it("returns an empty tree for an empty listing", () => {
    expect(buildTree([])).toEqual([]);
  });

  it("creates missing parents and sorts directories before files", () => {
    const entries: ListedPath[] = [
      { path: "src/zeta.ts", kind: "file" },
      { path: "README.md", kind: "file" },
      { path: "src/lib/parser.ts", kind: "file" },
      { path: "src", kind: "directory" },
    ];

    expect(buildTree(entries)).toEqual([
      { path: "src", name: "src", kind: "directory", children: [
        { path: "src/lib", name: "lib", kind: "directory", children: [
          { path: "src/lib/parser.ts", name: "parser.ts", kind: "file" },
        ] },
        { path: "src/zeta.ts", name: "zeta.ts", kind: "file" },
      ] },
      { path: "README.md", name: "README.md", kind: "file" },
    ]);
  });

  it("preserves Git state on listed files", () => {
    expect(
      buildTree([{ path: "src/app.ts", kind: "file", gitState: "modified" }]),
    ).toEqual([
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
    ]);
  });

  it("rejects absolute and traversal paths", () => {
    expect(() => buildTree([{ path: "../secrets.txt", kind: "file" }])).toThrow(
      "workspace-relative",
    );
    expect(() => buildTree([{ path: "/etc/passwd", kind: "file" }])).toThrow(
      "workspace-relative",
    );
  });
});
