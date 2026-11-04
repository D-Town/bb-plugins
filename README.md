# BB Plugins

Community plugins for [BB](https://getbb.app/).

## Plugins

- [Dynamic File Tree](plugins/dynamic-file-tree/) — browse the active thread's
  workspace, Git changes, and files from BB's thread context sidebar.

## Development

Each plugin is an independent package under `plugins/`.

```bash
cd plugins/dynamic-file-tree
npm install
npm test
npm run typecheck
bb plugin types --check
bb plugin build
```

The repository is MIT-licensed. Individual plugins may include additional
third-party notices in their own directories.
