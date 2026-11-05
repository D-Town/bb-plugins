# Dynamic File Tree Explorer Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Thread Info section with a fixed BB side-panel tab that renders a VS Code-style, lazy-loaded project explorer with Git status, previews, and real BB activity-driven auto-expansion.

**Architecture:** The app registers `experimental_tab` with `availability: "fixed"`, `context: { kind: "thread" }`, and `icon: "FolderTree"`. The server exposes read-only RPC methods for direct directory listings, bounded previews, and activity snapshots; it listens to `experimental_thread.events` and publishes normalized activity updates over plugin realtime. The frontend keeps `manualExpanded` and `autoExpanded` separately and renders their union.

**Tech Stack:** TypeScript, React/TSX, `@get-bb/plugin-sdk` 0.6.104+, Zod, Vitest, Testing Library, jsdom, BB plugin build, and the bundled `bb--git` RPC.

## Global Constraints

- Plugin ID: `dynamic-file-tree`; package directory: `plugins/dynamic-file-tree/`.
- The primary surface is a fixed thread tab, never a Thread Info section or global navigation panel.
- Filesystem reads use the active Environment's explicit `hostId` and project path; never the server process working directory.
- The plugin remains read-only: no writes, moves, deletes, renames, or agent-context injection.
- Root entries are collapsed initially; dotfiles are visible; folders sort before files.
- Manual expansion and activity-driven expansion are independent state layers.
- Only explicit, project-relative file/read/write/search/list activity paths may auto-expand folders.
- Opaque pathless shell commands must not cause arbitrary expansion.
- A Nerd Font is optional and never a runtime requirement.
- Reused code/assets from `data-goblin/claude-code-filetree` retain MIT attribution in `THIRD_PARTY_NOTICES.md`.
- Every task ends with focused tests and a commit; the final task runs `npm test`, `npm run typecheck`, `bb plugin types --check`, and `bb plugin build`.

---

## Repository Map

- Modify `plugins/dynamic-file-tree/app.tsx`: fixed-tab registration and tab-level data/realtime hooks.
- Modify `plugins/dynamic-file-tree/server.ts`: tree, preview, activity RPCs and thread-event listener.
- Modify `plugins/dynamic-file-tree/src/contracts.ts`: strict RPC schemas and shared types.
- Modify `plugins/dynamic-file-tree/src/tree-model.ts`: direct-child entries, lazy-directory metadata, Git annotations, safe paths.
- Modify `plugins/dynamic-file-tree/src/server-data.ts`: Environment resolution, direct listing, bounded preview reads, Git merge.
- Create `plugins/dynamic-file-tree/src/activity-model.ts` and its test: timeline normalization and ancestor calculation.
- Create `plugins/dynamic-file-tree/src/activity-bridge.test.ts`: server snapshot/realtime boundary tests.
- Replace `plugins/dynamic-file-tree/src/components/FileTreeSection.tsx`: explorer UI, lazy loading, expansion state, icons, preview activation.
- Replace `plugins/dynamic-file-tree/src/components/FileTreeSection.test.tsx`: explorer behavior tests.
- Modify `plugins/dynamic-file-tree/src/app.test.tsx` and `src/server-data.test.ts`.
- Modify `plugins/dynamic-file-tree/README.md` and `PLUGIN_OVERVIEW.md`; update `THIRD_PARTY_NOTICES.md` only when source/assets are reused.

---

### Task 1: Convert the app surface to a fixed thread tab

**Files:** `app.tsx`, `src/contracts.ts`, `src/app.test.tsx`.

**Interfaces:** Consume `ExperimentalThreadTabProps` (`threadId`, `environment`). Produce one `experimental_tab` registration with id `dynamic-file-tree`, title `Dynamic File Tree`, icon `FolderTree`, availability `fixed`, context `{ kind: "thread" }`, and layout `flush`.

- [ ] **Step 1: Write the failing registration test.** Replace the old `threadInfoSections` assertion with a `captured.tabs` assertion for the exact registration fields above, and assert that no Thread Info section is registered.
- [ ] **Step 2: Run `npm test -- --run src/app.test.tsx` and verify it fails because the current app still registers `experimental_threadInfoSection`.
- [ ] **Step 3: Implement `DynamicFileTreeTab` and register it with `app.slots.experimental_tab`.** Remove `experimental_InfoSection`; use `props.threadId` and `props.environment?.id` as the only context inputs.
- [ ] **Step 4: Add the shared activity schemas to `src/contracts.ts`:** `ActivePathActivity` with `activityId`, `path`, `kind: "read" | "write" | "search" | "list"`, and the four BB row statuses; `activity_snapshot` input `{ threadId }`; output `{ available, activities }`.
- [ ] **Step 5: Render a full-height tab shell with explicit no-environment and loading states.** Keep data fetching minimal until the new tree contract exists.
- [ ] **Step 6: Run `npm test -- --run src/app.test.tsx` and `npm run typecheck`; commit with `git commit -m "feat: register dynamic file tree as fixed thread tab"`.

---

### Task 2: Add safe direct-directory data and lazy tree contracts

**Files:** `src/contracts.ts`, `src/tree-model.ts`, `src/server-data.ts`, `server.ts`, `src/tree-model.test.ts`, `src/server-data.test.ts`.

**Interfaces:** `tree_list` consumes `{ environmentId: string; path: string }`, where `path` is `""` for the root. It produces `{ outcome: "available"; directory; entries; gitAvailable; truncated }` or explicit unavailable outcomes. `TreeEntry` becomes `{ path; name; kind; hasChildren?; children?; gitState? }`.

- [ ] **Step 1: Add failing model cases** for root files, `.gitignore`, directory-first sorting, unloaded directories with `hasChildren`, empty directories, duplicate prefixes, and rejection of `/absolute`, `a/../b`, `a//b`, `a/./b`, and backslash paths.
- [ ] **Step 2: Run `npm test -- --run src/tree-model.test.ts` and verify the new cases fail against the recursive-only model.
- [ ] **Step 3: Implement the lazy tree model.** Preserve deterministic directory-first/name sorting and safe relative paths; do not synthesize children for an unloaded directory.
- [ ] **Step 4: Change `listTreeInputSchema` to `{ environmentId: z.string().trim().min(1), path: z.string().default("") }`.** Dotfiles are always visible, so remove `includeHidden` from the public request.
- [ ] **Step 5: Implement direct listing in `server-data.ts`.** Resolve `bb.sdk.environments.get({ environmentId })`; return `no_workspace` when `environment.path` is null; validate the relative path; call `bb.sdk.hosts.directory({ hostId: environment.hostId, path: absoluteDirectory })` for direct entries; call `bb--git` `files` for annotations; return only project-relative paths.
- [ ] **Step 6: Derive folder Git markers from changed descendants, preserve `not_applicable` for non-Git environments, and keep host truncation/error information local to the requested directory.
- [ ] **Step 7: Update server registration and adapter stubs for root/nested listing, dotfiles, explicit host IDs, non-Git environments, missing workspaces, and traversal rejection.** Run `npm test -- --run src/tree-model.test.ts src/server-data.test.ts` and `npm run typecheck`.
- [ ] **Step 8: Commit with `git commit -m "feat: add lazy environment-scoped tree data"`.

---

### Task 3: Build the activity normalization and realtime bridge

**Files:** create `src/activity-model.ts`, `src/activity-model.test.ts`, and `src/activity-bridge.test.ts`; modify `src/contracts.ts`, `src/server-data.ts`, and `server.ts`.

**Interfaces:** Consume nested timeline rows from `bb.sdk.threads.timeline({ threadId, ... })` and `experimental_thread.events` payloads `{ thread, sequence }`. Produce `collectActiveActivities(rows: readonly unknown[]): ActivePathActivity[]`, `ancestorPaths(path: string): string[]`, `activity_snapshot`, and realtime channel `activity-updated` with `{ threadId, available, activities }`.

- [ ] **Step 1: Write failing model tests** for `file-read`, `file-change`, known-path search, list intent, nested turn rows, multiple activities, completion/error/interruption cleanup, and a command whose intent has `path: null`.
- [ ] **Step 2: Run `npm test -- --run src/activity-model.test.ts` and verify it fails because the module does not exist.
- [ ] **Step 3: Implement recursive normalization.** Recognize `file-read.path`, `file-change.change.path`, `search.path`, and command `activityIntents`; accept file-change paths plus explicit read/list/search command intents; preserve row id as `activityId`; reject absolute/traversal paths.
- [ ] **Step 4: Implement `ancestorPaths("src/components/Button.tsx")` as `["src", "src/components"]` and `activeAncestorPaths(activities)` as the deduplicated union of ancestors for pending activities only.
- [ ] **Step 5: Test the snapshot adapter with a nested timeline fixture and a timeline failure.** The failure must return `{ available: false, activities: [] }` rather than throw through the UI.
- [ ] **Step 6: Implement `activity_snapshot` with `bb.sdk.threads.timeline` using nested rows and a non-summary response that exposes status/path fields.** In `server.ts`, listen with `bb.events.on("experimental_thread.events", ({ thread, sequence }) => ...)`, call the snapshot adapter, and publish `bb.realtime.publish("activity-updated", { threadId: thread.id, sequence, ...snapshot })`.
- [ ] **Step 7: Run `npm test -- --run src/activity-model.test.ts src/activity-bridge.test.ts` and `npm run typecheck`; commit with `git commit -m "feat: bridge thread activity to file tree"`.

---

### Task 4: Implement explorer state, lazy interaction, and automatic expansion

**Files:** replace `src/components/FileTreeSection.tsx` and its test; modify `app.tsx`.

**Interfaces:** Consume direct `tree_list` results, `activity_snapshot`, `activity-updated`, `threadId`, and `environment`. Produce manual/automatic expansion state, per-directory loading/error state, selected path, and accessible tree rows.

- [ ] **Step 1: Write failing component tests** for collapsed roots, folder requests `tree_list({ environmentId: "env_1", path: "src" })`, child rendering, manual close/reopen, local child errors, and manual expansion surviving an empty activity update.
- [ ] **Step 2: Run `npm test -- --run src/components/FileTreeSection.test.tsx` and verify it fails against the recursive prop-based component.
- [ ] **Step 3: Implement `ExplorerState` with `manualExpanded`, `autoExpanded`, `selectedPath`, and a directory cache.** Render the union of manual and automatic sets; directory clicks modify only the manual set; activity updates replace only the automatic set; reset per `threadId:environment.id`.
- [ ] **Step 4: Load the root with `tree_list({ environmentId, path: "" })`; load each direct directory once on opening; cache children and show an inline spinner/retry/error for only that directory.
- [ ] **Step 5: Subscribe with `useRealtime("activity-updated", handler)` and call `activity_snapshot` on mount.** Ignore other thread IDs; expand and load only ancestors of pending paths; clear only `autoExpanded` when activities complete or monitoring is unavailable.
- [ ] **Step 6: Test that `src/components/Button.tsx` opens only `src` and `src/components`, that two pending activities share ancestors correctly, and that pathless commands do not expand anything.
- [ ] **Step 7: Run focused component tests and `npm run typecheck`; commit with `git commit -m "feat: add lazy explorer expansion state"`.

---

### Task 5: Add developer-tool presentation, Git markers, and previews

**Files:** `src/components/FileTreeSection.tsx`, `src/contracts.ts`, `src/server-data.ts`, `server.ts`, `src/components/FileTreeSection.test.tsx`, `src/server-data.test.ts`, `src/app.test.tsx`.

**Interfaces:** Consume tree entries with Git state and selected relative paths. Produce deterministic extension icons and either native BB preview navigation or a bounded `file_preview` fallback result.

- [ ] **Step 1: Write failing tests** for folder/open-folder icons, `.ts`, `.md`, `.png`, and fallback file icons, `.gitignore`, accessible modified/untracked markers, native preview navigation, and local unsupported/too-large preview errors.
- [ ] **Step 2: Run `npm test -- --run src/components/FileTreeSection.test.tsx src/app.test.tsx src/server-data.test.ts` and verify the new assertions fail.
- [ ] **Step 3: Implement deterministic icon mapping and compact explorer styling.** Use BB-supported icon primitives, a monospace system fallback stack, indentation, chevrons, hover/selection states, and status colors with text/ARIA information. Do not rely on glyphs from a Nerd Font.
- [ ] **Step 4: Use `useBbNavigate().experimental_openFilePreview` with `{ target: { kind: "workspace", environmentId, path }, location: null }` for normal file activation. If an inline fallback is needed, add strict bounded preview schemas and read through `bb.sdk.files.read` with explicit `hostId` and `rootPath`.
- [ ] **Step 5: After file-change activity, invalidate only the affected directory and Git annotations. Preserve manual expansion and selected paths that still exist; remove only a missing file's preview.
- [ ] **Step 6: Run the visual/preview tests and `npm run typecheck`; commit with `git commit -m "feat: polish explorer rows and file preview"`.

---

### Task 6: Document, build, install, and verify the redesigned plugin

**Files:** `plugins/dynamic-file-tree/README.md`, `PLUGIN_OVERVIEW.md`, and `THIRD_PARTY_NOTICES.md` only when attribution changes.

**Interfaces:** Documentation matches the fixed-tab behavior, read-only scope, supported previews, lazy loading, and activity fallback.

- [ ] **Step 1: Document local install/reload commands, the fixed right-panel tab, root-collapsed behavior, lazy loading, manual versus automatic expansion, preview types, and activity monitoring fallback.
- [ ] **Step 2: Align `PLUGIN_OVERVIEW.md` with the manifest description and reference repository. State whether code/assets were copied; add the original MIT notice if they were.
- [ ] **Step 3: Run `npm test`, `npm run typecheck`, `bb plugin types --check`, and `bb plugin build` from `plugins/dynamic-file-tree/`.
- [ ] **Step 4: Run `bb plugin install . --yes` and `bb plugin reload dynamic-file-tree`; manually verify the tab order, collapsed root, dotfiles, lazy folders, native preview, activity expansion/cleanup, manual expansion preservation, and pathless-command behavior.
- [ ] **Step 5: Run `git diff --check` and `git status --short`; remove only generated untracked artifacts from the install/build; commit documentation with `git commit -m "docs: document dynamic file tree explorer"`.

## Self-review checklist

- Task 1 covers fixed-tab registration and removal of the old Thread Info section.
- Tasks 2 and 4 cover root-collapsed, dotfile-visible, directory-first, lazy loading behavior.
- Tasks 2 and 5 cover explicit Environment/host scoping, traversal protection, Git-unavailable state, and bounded preview.
- Tasks 3 and 4 cover file-read/file-change/search/list activity, multiple pending paths, cleanup, and pathless commands.
- Tasks 4 and 5 cover manual expansion preservation through activity cleanup and targeted refreshes.
- Task 6 covers documentation, attribution, build validation, and manual BB verification.
- No task depends on a Nerd Font, global current directory, polling loop, or arbitrary shell-output parsing.
