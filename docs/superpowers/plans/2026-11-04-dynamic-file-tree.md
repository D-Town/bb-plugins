# BB Plugin Dynamic File Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first BB-native `dynamic-file-tree` plugin that shows the
active thread's Environment/Worktree in the right thread context sidebar with
file navigation, Git status, and safe previews.

**Architecture:** The plugin is a standalone package under
`plugins/dynamic-file-tree/`. Its server owns a small, validated RPC surface
for filesystem and Git reads. Its frontend registers an
`experimental_threadContextCardSection` and renders a focused tree section
using the current `{ threadId, projectId, environment }` context. The first
version is read-only; BB's built-in workspace preview is used for selected
files where possible.

**Tech Stack:** TypeScript, React/TSX, `@get-bb/plugin-sdk`, Zod schemas,
Vitest/jsdom, BB plugin build/dev loop, and the bundled `bb--git` RPC.

## Global Constraints

- Plugin package name: `bb-plugin-dynamic-file-tree`.
- Plugin ID: `dynamic-file-tree`.
- Plugin directory: `plugins/dynamic-file-tree/`.
- The primary surface is the right thread context sidebar, not global sidebar navigation.
- The panel follows the active thread's Environment/Worktree and must not use a global current working directory.
- MVP is read-only: no file writes, moves, deletes, guards, or agent-context injection.
- MVP supports tree navigation, Git status, and previews for text, Markdown, and images.
- Agent activity, full-text search, treemaps, diffs, document formats beyond the MVP, and release automation are post-MVP.
- Keep the original MIT attribution for any copied code or assets from `data-goblin/claude-code-filetree`; record third-party notices for reused assets.
- Use current public BB SDK declarations; do not import private `@bb/*` modules.
- Run focused tests, `bb plugin types --check`, and `bb plugin build` before claiming completion.

---

## Repository Map

Create or modify only these files for the MVP unless the generated scaffold
requires an adjacent file:

- Create: `.bb/plugins.json` — root collection index for the plugin package.
- Create: `plugins/dynamic-file-tree/package.json` — BB manifest and package scripts.
- Create: `plugins/dynamic-file-tree/server.ts` — plugin factory and RPC wiring.
- Create: `plugins/dynamic-file-tree/src/contracts.ts` — shared Zod RPC schemas and TypeScript types.
- Create: `plugins/dynamic-file-tree/src/tree-model.ts` — pure tree normalization and sorting logic.
- Create: `plugins/dynamic-file-tree/src/tree-model.test.ts` — model tests.
- Create: `plugins/dynamic-file-tree/src/server-data.ts` — environment, filesystem, and Git read adapter.
- Create: `plugins/dynamic-file-tree/src/server-data.test.ts` — adapter behavior tests.
- Create: `plugins/dynamic-file-tree/app.tsx` — frontend registration and section entrypoint.
- Create: `plugins/dynamic-file-tree/src/components/FileTreeSection.tsx` — sidebar section state and layout.
- Create: `plugins/dynamic-file-tree/src/components/FileTreeSection.test.tsx` — frontend behavior tests.
- Create: `plugins/dynamic-file-tree/PLUGIN_OVERVIEW.md` — future marketplace overview, kept in sync with `bb.description`.
- Create: `plugins/dynamic-file-tree/THIRD_PARTY_NOTICES.md` — attribution for copied code/assets.
- Create or modify: `plugins/dynamic-file-tree/README.md` — local development and MVP behavior.
- Create: `plugins/dynamic-file-tree/vitest.config.ts` — test environment/config if the scaffold does not provide one.
- Create: `.github/workflows/ci.yml` — repository checks after the plugin package exists.

---

### Task 1: Scaffold the standalone BB plugin package

**Files:**
- Create: `plugins/dynamic-file-tree/package.json` and generated BB scaffold files.
- Create: `.bb/plugins.json`.
- Create: `plugins/dynamic-file-tree/README.md`.
- Create: `plugins/dynamic-file-tree/PLUGIN_OVERVIEW.md`.
- Create: `plugins/dynamic-file-tree/THIRD_PARTY_NOTICES.md`.

**Interfaces:**
- Produces a package whose manifest declares `bb.name`, `bb.description`,
  `bb.branding`, `bb.server`, `bb.app`, and `engines.bbPluginSdk` according to
  the current `bb plugin new` scaffold.
- Produces the collection entry `{ "name": "dynamic-file-tree", "source": "./plugins/dynamic-file-tree" }`.

- [ ] **Step 1: Verify the current BB scaffold command and SDK version**

Run:

```bash
bb plugin new --help
bb --version
```

Use the current scaffold rather than copying an older plugin template.

- [ ] **Step 2: Generate the plugin scaffold in a temporary path**

Run:

```bash
bb plugin new dynamic-file-tree
```

The command generates `bb-plugin-dynamic-file-tree/`. Move that generated
directory into `plugins/dynamic-file-tree/` without carrying over a root-level
plugin identity.

- [ ] **Step 3: Set the plugin identity**

Set the manifest to the package name `bb-plugin-dynamic-file-tree`, display name
`Dynamic File Tree`, and a short description that states the user outcome. Keep
the generated SDK and BB engine ranges.

- [ ] **Step 4: Add the collection manifest**

Create `.bb/plugins.json` with the current schema URL, `schemaVersion: 1`, the
repository collection name, and the relative plugin source.

- [ ] **Step 5: Add the initial documentation and notices**

Document the MVP, the right-sidebar behavior, local install/dev commands, and
the reference repository. Preserve the original MIT copyright and license
notice in `THIRD_PARTY_NOTICES.md` when code or assets are reused; do not claim
that BB or Anthropic authored the derivative.

- [ ] **Step 6: Install dependencies and verify the generated baseline**

Run from the plugin directory:

```bash
npm install
bb plugin types --check
bb plugin build
```

Expected: the generated package type-checks and builds before feature code is
added.

- [ ] **Step 7: Commit the scaffold**

```bash
git add .bb plugins/dynamic-file-tree
git commit -m "feat: scaffold dynamic file tree plugin"
```

---

### Task 2: Define and test the tree model

**Files:**
- Create: `plugins/dynamic-file-tree/src/contracts.ts`.
- Create: `plugins/dynamic-file-tree/src/tree-model.ts`.
- Create: `plugins/dynamic-file-tree/src/tree-model.test.ts`.

**Interfaces:**
- `TreeEntry`: `{ path: string; name: string; kind: "file" | "directory"; children?: TreeEntry[]; gitState?: GitState }`.
- `GitState`: a finite union for clean, modified, added, deleted, renamed, and untracked display states.
- `listTree` input/output schemas are shared by server and app through the
  package-local contract module.
- `buildTree(entries: ListedPath[]): TreeEntry[]` returns deterministic,
  directory-first, name-sorted nodes with POSIX-style relative paths.

- [ ] **Step 1: Write failing model tests**

Cover empty input, nested directories, directory-first sorting, stable
case-sensitive path handling, duplicate directory prefixes, and Git state
preservation on files.

- [ ] **Step 2: Run the model tests and verify they fail**

```bash
npm test -- --run src/tree-model.test.ts
```

Expected: FAIL because `buildTree` is not implemented.

- [ ] **Step 3: Implement the pure tree model**

Normalize only relative paths returned by the server, create missing parent
directories, reject traversal segments, and return a deterministic tree.
Keep this module independent of React and BB runtime calls.

- [ ] **Step 4: Run the model tests and verify they pass**

```bash
npm test -- --run src/tree-model.test.ts
```

Expected: PASS for every tree-model case.

- [ ] **Step 5: Commit the model**

```bash
git add plugins/dynamic-file-tree/src/contracts.ts plugins/dynamic-file-tree/src/tree-model.ts plugins/dynamic-file-tree/src/tree-model.test.ts
git commit -m "feat: add dynamic file tree model"
```

---

### Task 3: Implement the read-only server data adapter

**Files:**
- Create: `plugins/dynamic-file-tree/src/server-data.ts`.
- Modify: `plugins/dynamic-file-tree/server.ts`.
- Create: `plugins/dynamic-file-tree/src/server-data.test.ts`.

**Interfaces:**
- `listTree(input: { environmentId: string; includeHidden?: boolean }): Promise<ListTreeOutput>`.
- `readFile(input: { environmentId: string; path: string }): Promise<ReadFileOutput>`.
- `getGitStatus(input: { environmentId: string }): Promise<GitStatusOutput>`.
- All RPC inputs are Zod-validated and all outputs are bounded, strict JSON.

- [ ] **Step 1: Read exact SDK declarations for Environment routing**

After Task 1 installs the SDK, inspect the bundled declarations for the exact
Environment DTO and methods needed to resolve the environment's host and
workspace root. Do not infer field names from older APIs.

- [ ] **Step 2: Write failing adapter tests**

Use `createFakePluginHost` and stubs for the environment lookup,
`bb.sdk.files.listPaths`, `bb.sdk.files.read`, and
`bb.sdk.plugins.callRpc`. Test successful tree reads, missing environments,
path traversal rejection, oversized/unsupported preview content, and Git's
`not_applicable` outcome.

- [ ] **Step 3: Implement environment-scoped filesystem reads**

Resolve the active environment to an explicit host and workspace root. Call
`bb.sdk.files.listPaths({ path, hostId, includeFiles: true, includeDirectories: true })`
with the root confined to the resolved workspace. Convert returned paths into
the package-local `ListedPath` shape and pass them through `buildTree`.

- [ ] **Step 4: Implement file reads for preview metadata**

Call `bb.sdk.files.read` with the same `hostId` and `rootPath` confinement.
Return bounded text content or a typed unsupported/binary result. Never write,
move, remove, or create files in the MVP.

- [ ] **Step 5: Implement Git status through the bundled Git plugin**

Use `bb.sdk.plugins.callRpc({ pluginId: "bb--git", method: "status", ... })`
with the current environment ID and the exact contract from the current SDK
reference. Map Git outcomes to the local finite `GitState` union; preserve
`not_applicable` for non-Git workspaces.

- [ ] **Step 6: Register the three RPC methods**

Register `listTree`, `readFile`, and `getGitStatus` in `server.ts` using the
shared schemas. Keep the factory focused on registration and delegate logic to
`server-data.ts`.

- [ ] **Step 7: Run adapter tests and build**

```bash
npm test -- --run src/server-data.test.ts
bb plugin build
```

Expected: all adapter tests pass and the plugin build validates the RPC
schemas.

- [ ] **Step 8: Commit the server adapter**

```bash
git add plugins/dynamic-file-tree/server.ts plugins/dynamic-file-tree/src/server-data.ts plugins/dynamic-file-tree/src/server-data.test.ts
git commit -m "feat: add environment-scoped file and git reads"
```

---

### Task 4: Register and render the thread context section

**Files:**
- Create: `plugins/dynamic-file-tree/app.tsx`.
- Create: `plugins/dynamic-file-tree/src/components/FileTreeSection.tsx`.
- Create: `plugins/dynamic-file-tree/src/components/FileTreeSection.test.tsx`.

**Interfaces:**
- `FileTreeSection` receives `ExperimentalThreadContextCardProps` and uses
  the supplied `environment.id` plus `threadId` only for display/context.
- The app registers one `experimental_threadContextCardSection` with a stable
  plugin-owned ID and the environment-oriented group/order from the current
  SDK declarations.

- [ ] **Step 1: Write failing frontend tests**

Using `loadPluginApp` and `renderSlot`, assert that the section registration is
valid, that an environment identifier is sent to `listTree`, that an empty
environment renders the empty state, and that returned entries render folders
and files.

- [ ] **Step 2: Run frontend tests and verify failure**

```bash
npm test -- --run src/components/FileTreeSection.test.tsx
```

Expected: FAIL because the section and RPC wiring are not implemented.

- [ ] **Step 3: Register the context-card section**

Use `app.slots.experimental_threadContextCardSection({ id, title, group, order, component })`.
The component must return a useful empty state when `environment` is absent and
must not fall back to a global filesystem root.

- [ ] **Step 4: Implement tree loading and refresh state**

Call the plugin RPC with the current environment ID. Render loading, success,
non-Git, no-environment, and error states. Keep state keyed by the active
environment so switching threads cannot display the previous thread's tree.

- [ ] **Step 5: Implement folder expansion and selection**

Folders toggle locally without another server request. Selecting a file stores
the relative path and exposes an explicit preview action.

- [ ] **Step 6: Run frontend tests and verify success**

```bash
npm test -- --run src/components/FileTreeSection.test.tsx
```

Expected: PASS for registration, loading, empty, error, tree, and selection
behavior.

- [ ] **Step 7: Commit the sidebar section**

```bash
git add plugins/dynamic-file-tree/app.tsx plugins/dynamic-file-tree/src/components
git commit -m "feat: render file tree in thread context sidebar"
```

---

### Task 5: Connect safe BB previews and Git status presentation

**Files:**
- Modify: `plugins/dynamic-file-tree/src/components/FileTreeSection.tsx`.
- Modify: `plugins/dynamic-file-tree/src/server-data.ts` if preview metadata needs a server adjustment.
- Modify: `plugins/dynamic-file-tree/src/components/FileTreeSection.test.tsx`.

**Interfaces:**
- A selected workspace file is opened through the public BB file-preview
  navigation API with `{ kind: "workspace", environmentId, path }`.
- Git states render as bounded text/icon indicators and never alter file
  contents.

- [ ] **Step 1: Add failing preview and Git-state tests**

Assert that selecting a text, Markdown, or image file invokes the workspace
preview navigation with the current environment ID and relative path, and that
modified/untracked/deleted states render their corresponding labels.

- [ ] **Step 2: Implement preview navigation**

Use the SDK's `experimental_openFilePreview`/`experimental_FileLink` contract
from the installed declarations. Keep the target workspace-relative and
confined to the active environment.

- [ ] **Step 3: Implement Git indicators**

Render a compact, accessible status indicator on files and aggregate status on
directories only when the server provides it. Do not infer status from file
names or timestamps.

- [ ] **Step 4: Run preview tests and build**

```bash
npm test -- --run src/components/FileTreeSection.test.tsx
bb plugin types --check
bb plugin build
```

- [ ] **Step 5: Commit preview and status presentation**

```bash
git add plugins/dynamic-file-tree
git commit -m "feat: add file previews and git status indicators"
```

---

### Task 6: Add repository CI and perform the live BB verification

**Files:**
- Create: `.github/workflows/ci.yml`.
- Modify: `plugins/dynamic-file-tree/README.md` if live setup reveals required instructions.

**Interfaces:**
- CI runs with read-only defaults and invokes plugin-local install, tests,
  `bb plugin types --check`, and `bb plugin build`.

- [ ] **Step 1: Add the CI workflow**

Use Node setup and npm caching. Pin every third-party action to a full-length
commit SHA to satisfy the repository's Actions policy. Run the checks from
`plugins/dynamic-file-tree/` and fail on any type, test, or build error.

- [ ] **Step 2: Run the same commands locally**

```bash
cd plugins/dynamic-file-tree
npm ci
npm test
bb plugin types --check
bb plugin build
```

- [ ] **Step 3: Install and exercise the plugin in BB**

```bash
bb plugin install ./plugins/dynamic-file-tree --yes
bb plugin dev dynamic-file-tree
```

Open two threads with different Environments/Worktrees and verify that the
right-sidebar tree changes with the active thread. Check a non-Git environment,
a Git repository, a text file, a Markdown file, and an image.

- [ ] **Step 4: Fix live-only issues and rerun validation**

Keep pure logic in the tested modules; use the live loop only for host layout,
slot placement, navigation, and preview behavior that the jsdom harness cannot
reproduce.

- [ ] **Step 5: Commit the verified CI and documentation**

```bash
git add .github/workflows/ci.yml plugins/dynamic-file-tree/README.md
git commit -m "ci: validate dynamic file tree plugin"
```

---

## Post-MVP Release Work

After the MVP is validated and the user approves the feature branch, add
Release Please v5 in a separate change. Use a manifest configuration for
`plugins/dynamic-file-tree/`, keep release tags component-specific, and only
enable the Actions permission for creating pull requests when that workflow is
ready. Add issue/PR templates and Dependabot version-update configuration in
the same repository-governance change, not inside the feature implementation.

