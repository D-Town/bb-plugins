// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileTreeView } from "./FileTreeSection";

describe("FileTreeView", () => {
  it("renders nested entries and toggles a directory", () => {
    const onSelect = vi.fn();

    render(
      <FileTreeView
        entries={[
          {
            path: "src",
            name: "src",
            kind: "directory",
            children: [
              { path: "src/app.ts", name: "app.ts", kind: "file", gitState: "modified" },
            ],
          },
        ]}
        onSelect={onSelect}
      />,
    );

    expect(screen.queryByRole("button", { name: "app.ts" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "src" }));
    expect(screen.getByRole("button", { name: "app.ts" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "app.ts" }));
    expect(onSelect).toHaveBeenCalledWith("src/app.ts");
    expect(screen.getByText("modified")).toBeTruthy();
  });
});
