import { describe, expect, it } from "vitest";
import { buildTree } from "./tree-model";

describe("buildTree", () => {
  it("returns an empty listing", () => {
    expect(buildTree([])).toEqual([]);
  });

  it("sorts direct entries directory-first by name and preserves dotfiles", () => {
    expect(buildTree([
      { path: "z.ts", kind: "file" },
      { path: "src", kind: "directory" },
      { path: ".gitignore", kind: "file" },
      { path: "assets", kind: "directory" },
      { path: "README.md", kind: "file", gitState: "modified" },
    ])).toEqual([
      { path: "assets", name: "assets", kind: "directory" },
      { path: "src", name: "src", kind: "directory" },
      { path: ".gitignore", name: ".gitignore", kind: "file" },
      { path: "README.md", name: "README.md", kind: "file", gitState: "modified" },
      { path: "z.ts", name: "z.ts", kind: "file" },
    ]);
  });

  it("keeps unloaded and known-empty directories distinct without synthesizing children", () => {
    expect(buildTree([
      { path: "src", kind: "directory", hasChildren: true },
      { path: "empty", kind: "directory", hasChildren: false },
    ])).toEqual([
      { path: "empty", name: "empty", kind: "directory", hasChildren: false },
      { path: "src", name: "src", kind: "directory", hasChildren: true },
    ]);
  });

  it("keeps nested direct entries project-relative without creating parent nodes", () => {
    expect(buildTree([{ path: "src/app.ts", kind: "file", gitState: "added" }])).toEqual([
      { path: "src/app.ts", name: "app.ts", kind: "file", gitState: "added" },
    ]);
  });

  it("deduplicates exact paths without merging entries with shared prefixes", () => {
    expect(buildTree([
      { path: "src", kind: "directory" },
      { path: "src-other", kind: "directory" },
      { path: "src", kind: "directory" },
      { path: "src.ts", kind: "file" },
    ]).map((entry) => entry.path)).toEqual(["src", "src-other", "src.ts"]);
  });

  it.each(["/absolute", "a/../b", "a//b", "a/./b", "a\\b", "../secret", "", "C:/secret", "a\0b"])(
    "rejects unsafe project-relative path %j", (path) => {
      expect(() => buildTree([{ path, kind: "file" }])).toThrow("workspace-relative");
    },
  );
});
