# Dynamic File Tree Prompt Implementation Plan

**Goal:** Bring the existing BB Dynamic File Tree plugin closer to the supplied filetree prompt: activity-driven expansion and glow, diff/status presentation, settings, and robust workspace data.

**Architecture:** Keep the existing plugin id and fixed thread tab so the current installation remains usable. Replace the current snapshot-only activity path with a server-side event collector and bounded RPC snapshots, then make the React tree derive visible rows from activity, manual overrides, status markers, and preferences held in memory.

**Tech Stack:** TypeScript, React, Zod, BB Plugin SDK 0.6.104, Vitest/jsdom.

## Global Constraints

- Keep the existing package id `bb-plugin-dynamic-file-tree` and current fixed thread tab.
- Use only public SDK APIs and validate all RPC input/output with Zod.
- Keep activity TTLs bounded: 60 seconds server-side, 30 seconds client glow, 15 minutes for add/delete markers.
- No persistence for tree expansion; only preferences use `bb.storage.kv`.
- Run focused tests after each subsystem, then full tests, typecheck, and build.

## Task 1: Contract and server activity model

Modify `plugins/dynamic-file-tree/src/contracts.ts` and `src/server-data.ts`. Add workspace, tree, activity, preferences, stats, and log RPC contracts while retaining the existing preview RPC. Parse `experimental_thread.events` rows from `threads.events.list`, recognize nested or flat `fileRead`/`fileChange` items, count diff lines, aggregate file and folder status, and publish bounded `filetree-activity` payloads. Add fake-host tests for event parsing, TTL pruning, diff counting, path normalization, and RPC outputs.

## Task 2: Prompt-driven frontend state

Modify `plugins/dynamic-file-tree/src/components/FileTreeSection.tsx` and `app.tsx`. Add in-memory manual overrides, follow-mode expansion, activity aging, status/ghost rows, settings controls, branch/header metadata, diff chips, optional size/mtime columns, and read/write glow classes. Subscribe to `filetree-activity`, load the new RPCs, and preserve native file preview navigation. Add jsdom tests for expansion precedence, fade/prune behavior, settings updates, ghost rows, and row presentation.

## Task 3: Styling, icons, and docs

Move the prompt-driven styles into `plugins/dynamic-file-tree/app.css`, add the Lucide/Nerd-Font fallback mapping and settings copy, and update README/PLUGIN_OVERVIEW/SKILL.md to document activity TTLs, preferences, and the MIT concept credit.

## Task 4: Verification

Run the complete plugin test suite, `npm run typecheck`, and `npm run build`. Reload the installed plugin with `bb plugin reload dynamic-file-tree` and manually verify the fixed tab, activity glow, auto-collapse, diff chips, status markers, and settings menu.
