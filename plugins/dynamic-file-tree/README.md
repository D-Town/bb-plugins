# BB Plugin Dynamic File Tree

An MVP BB plugin for browsing the active thread's Environment or Worktree in
the right thread sidebar.

The first release is intentionally read-only. It will show the project tree,
Git status, and BB's built-in preview for text, Markdown, and image files. The
panel follows the active thread instead of using a global working directory.

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
