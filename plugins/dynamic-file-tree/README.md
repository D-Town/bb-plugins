# BB Plugin Dynamic File Tree

An MVP BB plugin for browsing the active thread's Environment or Worktree in
the right thread sidebar.

The plugin shows the active thread's project tree, Git status, line diffs, file
size/mtime decorations, and BB's built-in preview for text, Markdown, and image
files. Agent reads and writes are highlighted live; changed and deleted files
receive temporary status markers. The panel follows the active thread instead
of using a global working directory.

The gear menu controls diff counts, size/mtime columns, full paths, Nerd-Font
icons, and activity-driven auto-collapse. Preferences are stored through the
plugin's namespaced BB key-value storage; tree expansion itself is session
state and is intentionally not persisted.

## Development

From this directory:

```bash
npm install
bb plugin types --check
bb plugin build
```

Install the local plugin while developing:

```bash
bb plugin install . --yes
bb plugin dev .
```

The plugin uses the current BB SDK declarations from
`node_modules/@get-bb/plugin-sdk/bundled-types/`. Run `bb plugin types` after
upgrading BB so the package tracks the host SDK.

## Reference and attribution

The interaction concept is inspired by
[`data-goblin/claude-code-filetree`](https://github.com/data-goblin/claude-code-filetree).
Any copied code or assets retain their original notices; see
`THIRD_PARTY_NOTICES.md`.
