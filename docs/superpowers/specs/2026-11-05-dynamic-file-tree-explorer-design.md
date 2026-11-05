# BB Plugin Dynamic File Tree – Explorer Redesign

Status: Draft for user review

This specification supersedes the initial MVP design in
`docs/superpowers/specs/2026-11-04-dynamic-file-tree-design.md` wherever the
two documents differ.

## Goal

`BB Plugin Dynamic File Tree` provides a dedicated, fixed tab in BB's right
panel. The tab behaves like a compact, VS Code-style project explorer for the
active thread's Environment or worktree.

The explorer is not a section inside Thread Info. BB owns the panel tab strip;
the plugin registers one non-closable thread tab with the `FolderTree` icon:

`Thread Info | Diff | Dynamic File Tree | New Tab | +`

The tab always follows the currently selected thread and shows that thread's
project context. It does not become a second global file browser.

The visual direction is inspired by
[`data-goblin/claude-code-filetree`](https://github.com/data-goblin/claude-code-filetree),
which is MIT licensed. Any reused source or asset must retain its original
license and attribution in `THIRD_PARTY_NOTICES.md`; the implementation should
prefer BB-native primitives and original plugin code where practical.

## Scope of the first explorer release

The release includes:

- a fixed `experimental_tab` registration for thread context;
- a full-height explorer surface with a compact developer-tool appearance;
- the active Environment/worktree's project tree;
- visible dotfiles and dot-directories;
- directory-first sorting and stable indentation;
- file and folder icons, with a deterministic fallback icon;
- Git status indicators and status colors where Git is available;
- lazy child loading for large projects;
- text, Markdown, and image preview without replacing the explorer tab;
- real-time activity-driven auto-expansion for relevant paths;
- clear loading, empty, permission, unsupported-file, and error states.

The release does not include:

- full-text project search;
- treemaps;
- editing, deleting, moving, or renaming files;
- agent-context injection by selecting a file;
- a custom diff editor;
- automatic expansion of arbitrary paths inferred from opaque shell output;
- a required Nerd Font or other user-installed font;
- additional document formats beyond the agreed preview set.

## Tab and context contract

The frontend registers a thread tab with the following semantics:

```ts
app.slots.experimental_tab({
  context: { kind: "thread" },
  availability: "fixed",
  id: "dynamic-file-tree",
  title: "Dynamic File Tree",
  icon: "FolderTree",
  component: DynamicFileTreeTab,
  layout: "flush",
});
```

The tab receives the current `threadId` and an Environment reference. BB owns
tab persistence, selection, placement, and the surrounding panel. The plugin
must not emulate the tab strip or insert content into Thread Info.

When BB changes the active thread, the tab keeps its identity but replaces its
data source. Tree contents, Git state, activity state, selected file, and
preview state are scoped by `threadId` and Environment ID so concurrent or
previous threads cannot leak state into one another.

If the thread has no usable Environment or project root, the tab shows a
specific empty state with the reason and a refresh action. It must not silently
fall back to the agent process's current working directory.

## Explorer presentation

The tab is a full-height, scrollable explorer with a restrained developer-tool
visual language:

- root entries are initially collapsed;
- folders appear before files;
- names use stable, readable indentation and chevrons;
- dotfiles are shown rather than filtered out;
- file icons are selected by extension/type and fall back consistently;
- folders use folder/open-folder icons;
- Git state is shown through a small status marker and accessible color/state
  treatment;
- the active or previewed file has a clear selection highlight;
- text uses a monospace system fallback stack; a Nerd Font is optional and is
  never a runtime requirement;
- icons come from BB/plugin-supported icon primitives rather than relying on
  glyphs that may be missing from the user's font.

The initial render loads only the project root entries. Expanding a folder
loads its direct children. A folder opened automatically by activity may load
the required child chain without opening unrelated sibling directories.

## Tree data and Git state

The server resolves the active Environment through the BB SDK and performs
environment-scoped, read-only path listing. The client receives normalized
relative POSIX paths, entry kind, display name, and optional Git state.

The tree model must:

- reject traversal outside the project root;
- preserve dotfiles and dot-directories;
- produce deterministic directory-first ordering;
- keep directory and file paths distinct;
- represent an unavailable Git repository as `not_applicable`, not as an
  all-files-modified state;
- refresh after a completed file-change activity;
- tolerate a file disappearing between listing and preview.

Git status is an annotation, not the source of truth for tree membership.
Git-unavailable or permission-limited environments still show the filesystem
tree when possible.

## Expansion state

Expansion is intentionally split into two independent sets:

- `manualExpanded`: folders opened by the user;
- `autoExpanded`: folders opened temporarily because an active AI operation is
  working inside them.

The rendered state is the union of both sets. A completion, error, or
interruption may remove only entries from `autoExpanded`. It must never close a
folder the user opened manually.

Manual expansion is retained while the tab remains in the current thread and
Environment. Persistence across an application restart is optional and not a
release requirement; if implemented, the key must include both thread ID and
Environment ID.

When an activity targets `src/components/Button.tsx`, the plugin may open only
the smallest required ancestor chain, for example `src` and
`src/components`. It must not expand the whole project or unrelated siblings.

## Activity integration

Activity integration uses the real BB thread activity stream, not periodic
filesystem polling and not Git status as a proxy for agent activity.

The backend maintains a normalized set of relevant active activities for the
current thread. On tab mount it performs a snapshot reconciliation from the
thread timeline. It then listens for BB's coalesced thread-event notification
and refreshes the relevant timeline/event state when the sequence advances.

The normalized activity contract contains at least:

```ts
type ActivePathActivity = {
  activityId: string;
  path: string;
  kind: "read" | "write" | "search" | "list";
  status: "pending" | "completed" | "error" | "interrupted";
};
```

The following activities may auto-expand a path:

- `file-read` for its file path;
- `file-change` for its changed file path;
- search activity when it has a known project-relative path;
- list-files activity when it has a known project-relative path;
- command activity only when its structured activity intents expose a known
  read, list, search, or write path.

Opaque shell commands without a recognizable project-relative path do not open
anything automatically. Their completion may still trigger a tree/Git refresh
when the activity indicates that files could have changed.

When several activities are pending, their ancestor chains are unioned. An
activity ending removes its contribution only when no other active activity
still needs that path. Completed, errored, and interrupted activities all
follow this cleanup rule.

If activity subscription or reconciliation is unavailable, the tree remains
fully usable and the tab displays no false activity state. Automatic expansion
pauses until the next successful reconciliation.

## File interaction and preview

Clicking a directory toggles its manual expansion. Clicking a supported file
selects it and opens its content through BB's supported file-preview path while
keeping the Dynamic File Tree tab selected.

The preview layer must enforce bounded reads and distinguish:

- text and Markdown content;
- supported images;
- binary or unsupported files;
- files that are too large;
- files that disappeared or are no longer readable.

Preview failures are local to the selected file and must not blank the tree.
Selection is never sent to the agent automatically and does not modify files.

## Loading, refresh, and error behavior

The tab has separate states for:

- initial tree loading;
- loading children for one expanded folder;
- Git status unavailable;
- no Environment/project;
- permission or path errors;
- activity monitoring unavailable;
- empty project;
- unsupported or too-large preview.

A refresh action reloads the affected Environment data and reconciles activity
state. A file-change activity triggers a targeted refresh of the relevant
directory where possible, followed by Git status refresh. The implementation
must avoid resetting unrelated manual expansion during refresh.

## Security and permissions

All filesystem operations remain scoped to the active Environment and project
root. User-provided or activity-derived paths are normalized and rejected if
they escape that root. The plugin is read-only in this release.

No file contents are transferred to the agent merely because they appear in
the tree. Content is read only after the user selects a file for preview, and
the preview read remains bounded.

## Testing and acceptance criteria

The implementation is acceptable when all of the following are true:

1. The plugin registers as a fixed thread tab with the `FolderTree` icon.
2. The tab follows the active thread's Environment without using a global
   working directory.
3. Root entries are visible while folders are initially collapsed.
4. Dotfiles, directory-first sorting, icons, indentation, and Git markers are
   rendered deterministically.
5. Manual folder expansion survives activity cleanup and relevant refreshes.
6. File-read, file-change, search, and known-path list activities expand only
   the required ancestor chains.
7. Multiple active activities are merged correctly; cleanup does not close
   paths still needed by another activity.
8. Generic pathless commands do not cause arbitrary expansion.
9. Activity loss degrades to a usable tree without false state.
10. File selection opens a bounded supported preview without replacing the tab.
11. Missing environments, permission errors, unsupported files, large files,
    and Git-unavailable projects have clear local states.
12. Unit, component, and integration-facing tests pass, as do typecheck,
    `bb plugin types --check`, and `bb plugin build`.

## Follow-up features

After this release, the architecture can support full-text project search,
custom diffs, richer activity affordances, document previews, context handoff,
file actions, and optional persisted expansion state. Each should be designed
as a separate change rather than silently expanding this release's scope.
