# Parallel Tasks M2 — TDD Implementation Plan

Status: plan of record for M2 · Prereq: M1 landed (`BackendHandle`, commit 753e32f7)
· Companion: `parallel-tasks-design.md`

Every step below is a red → green increment: write the listed tests first,
watch them fail, implement the minimal change, and keep the standing invariant
suites green. main must be releasable after every step.

## 0. Decisions locked at M2 start

Answers to the design doc's open questions, plus one architecture refinement
made after auditing the real renderer store:

1. **Prompting a background task: switch first.** The composer only ever talks
   to the active task. Simpler mental model, no hidden fan-out.
2. **Backends spawn lazily** at `task:create`, never eagerly at app start.
3. **Pool full → refuse** `task:create` with an error listing the running
   tasks. No queueing.
4. **Two-tier renderer state (supersedes design §3.2's "TaskSlice holds
   everything").** The store today is a 912-line single-conversation
   `AppState` consumed by every component, with one event listener
   (`ipc/events.ts`) switching over event types. Forking all of it per task is
   high-risk surgery for no user-visible gain. Instead:
   - The **active task keeps using the existing `AppState` fields** —
     components don't change how they read state.
   - A new lightweight **task registry slice** (`tasks: Record<taskId,
     TaskSummary>`, `activeTaskId`) tracks per-task metadata: cwd, ready,
     streaming, unread count, completion, session name.
   - **Background tasks do not maintain live message buffers in the
     renderer.** Their tagged events only update the registry (streaming dot,
     unread badge, completion toast). On switch, the renderer hydrates from
     that task's backend (`get_state` + `get_messages` + the existing
     refresh fan-out) — the exact path workspace switching already exercises —
     but **without restarting any process**, then resumes live ingestion.
   - Cost: a short hydration moment on switch (one backend round-trip).
     Gain: no store fork, bounded memory, and the design doc's "switching
     mid-stream loses nothing" still holds — the backend session is the source
     of truth.
5. **Event back-compat rule:** an event with no `backendId`, or an unknown
   one, is treated as the primary's. (M1 already tags everything; this guards
   version skew and tests.)

## Standing invariants (checked after every step)

- All existing desktop unit tests, renderer vitest, and the 5 e2e tests pass
  **unmodified** (except where a step explicitly extends them).
- `npm run check` green.
- No new IPC channel bypasses the backend-command allowlist model: `task:*`
  are main-process channels like `git:*`; `backend:request` keeps its command
  allowlist unchanged.

## Phase A — main process pool (node:test, no Electron)

### A1. Task registry module — `src/task-registry.js`

Red (`test/task-registry.test.js`):
1. `create(cwd)` builds tasks up to the cap (default 3) with stable unique ids
   (`task_1`, `task_2`, …) via an injected `createHandle(id, cwd)` factory,
   and starts the handle lazily (factory invoked, `start()` called once).
2. At the cap, `create` throws an error whose message lists the running
   tasks' ids/cwds.
3. `create` refuses a cwd already claimed by a *running* task or by the
   primary workspace — same-repo isolation is M3; the refusal message says so.
4. `get(taskId)` returns the entry; `get(undefined)` returns the primary;
   unknown id throws "Unknown task".
5. `stop(taskId)` calls `handle.stop()` and removes the entry; stopping the
   primary throws.
6. `list()` returns live `{ taskId, cwd, isPrimary, ready, starting,
   streamingHint }` snapshots read from the handles.
7. `stopAll()` stops the primary and every pool member (before-quit path).

Green: implement the registry as a small class/factory owning the `Map`
that M1 left in `main.js`; `main.js` constructs it with the real
`BackendHandle` factory and keeps `primaryBackend` as the pre-registered
primary entry.

### A2. IPC wiring + routing — `main.js`, `preload.cjs`

No new unit surface (Electron-bound); covered by Phase C e2e. Changes:
- `ipcMain.handle("task:create", ({cwd}))` / `"task:list"` / `"task:stop"`.
- `backend:request`, `backend:send`, `backend:get-status`,
  `backend:get-pending-extension-ui-requests` accept an optional trailing
  `taskId` and resolve through `registry.get(taskId)` (default primary).
  Renderer api signatures gain the optional param in Phase B4.
- Workspace-scoped IPC (`git:*`, `workspace:*`, `session:*`) stays
  primary-only in M2 — the git panel and sidebar sessions describe the
  primary workspace. Documented limitation, revisited in M3.
- Per-task `notify` hook: completion notification names the task.
- `before-quit` → `registry.stopAll()`.

Invariant: the whole existing e2e suite green before Phase B starts (the
renderer still ignores everything new).

## Phase B — renderer two-tier state (vitest; @testing-library for UI)

### B1. Pure task-registry logic — `src/store/taskRegistry.ts`

Red (`src/store/taskRegistry.test.ts`):
1. `routeEvent(state, event)` for a tagged event of a **background** task →
   `{ forward: false }` and registry updates: `streaming` flips on
   agent_start, unread++ on message_end, `completed` + `notify: true` on
   non-retry agent_end.
2. Same events for the **active** task → `{ forward: true }`, unread stays 0.
3. Untagged or unknown `backendId` → routed as primary (decision 5).
4. `switchTask(state, taskId)` → activeTaskId set, unread reset, hydration
   request descriptor returned.
5. Registry entries created from `task:list` snapshots merge with live event
   state without losing unread counts.

### B2. Store integration — `src/store/index.ts`

Red: new vitest cases (extend existing store tests, do not rewrite them):
- `registerTask`/`updateTaskFromEvent`/`switchTask` actions exist;
  `switchTask` triggers hydration through the api layer with the taskId and
  swaps `activeTaskId` synchronously (workspaceLoading-style guard so the UI
  never flashes empty state).
- Regression net: the full existing `workspaceReset.test.ts` (681 lines)
  passes untouched — it pins the hydration path M2 reuses.

### B3. Event router — `src/ipc/events.ts`

Red: extend the events tests:
- A tagged background event updates the registry and does **not** reach
  `upsertMessage`/`setStreaming`.
- Active-task events flow into the existing switch unchanged (pinned by the
  current tests staying green).
- `isBackendEventCurrent` becomes per-task: the active task's events validate
  against *its* backend cwd from the registry, not the module-level workspace.

### B4. API layer — `src/ipc/api.ts`, `preload.cjs` types

- `request`/`send`/`getBackendStatus` accept optional `taskId`; new
  `createTask(cwd)`, `listTasks()`, `stopTask(taskId)` wrappers.
- Type-only + passthrough; covered by B5/C tests.

### B5. Sidebar tasks UI — `@testing-library` (starts the batch-4 interaction-test debt)

Red (`src/components/Sidebar/SidebarTasks.test.tsx`, jsdom + Testing Library):
1. Renders a row per pool task: name/cwd, running dot while `streaming`,
   unread badge count.
2. Click on a row → `switchTask` with that id; badge clears.
3. Stop affordance → `api.stopTask` called; row removed on success.
4. "New parallel task" affordance disabled at the cap with the reason in the
   tooltip; enabled otherwise; picks a folder then calls `api.createTask`.
5. Completion of a background task surfaces a toast (assert via Toast test
   seam).

Green: extract the Tasks section of `Sidebar.tsx` into a `SidebarTasks`
component fed by the registry slice (keeps `Sidebar.tsx` from growing; makes
the component testable in isolation).

### B6. Composer binding

Red: one @testing-library case — submitting the composer calls
`api.request({type:"prompt"...}, activeTaskId)`; a background task's
streaming never disables the active composer.

## Phase C — e2e capstone

### C1. Harness extension — `test/e2e/harness.mjs`

- `launchStudio` option `extraWorkspaces: n` → creates sibling temp
  workspace dirs, returned for the test to use.
- Faux server: add a per-step `delayMs` drip option so a reply can be held
  open long enough to observe cross-task interleaving deterministically.

### C2. `test/e2e/parallel-tasks.test.js`

The M2 definition-of-done test:
1. Launch with two workspaces; prompt the primary with a slow-drip reply.
2. Create a pool task in workspace B from the sidebar; prompt it after
   switching.
3. While B streams, assert the sidebar shows both rows running (primary badge
   updates prove background ingestion).
4. Switch back to A mid-stream; assert A's transcript is complete after
   hydration and B's unread badge grows.
5. Stop B; row disappears; primary unaffected (send one more prompt round).
6. Quit cleanly (no orphaned backend: poll that B's pid exited).

## Phase D — hygiene and closure

- Shared-agentDir concurrency audit, recorded in `parallel-tasks-design.md`
  §3.4: models.json read-only ✔, trust.json lockfile ✔, settings.json and
  auth.json writes = last-write-wins (documented as acceptable; both are
  user-initiated and rare).
- CHANGELOG entry; memory update; design doc M2 section marked landed with
  deviations noted (two-tier store).

## Definition of done

- Phases A-C tests all green; every pre-existing suite green unmodified
  (workspaceReset, events, e2e ×5).
- e2e suite is now 6 tests including `parallel-tasks`.
- `npm run check`, CI, and Desktop E2E workflows green.
- Manual smoke on Windows: two folders, two live streams, switch during both,
  stop one, quit — no orphan `pi-studio-backend.exe` in Task Manager.

## Step order and landing strategy

A1 → A2 (commit: pool behind unused IPC — invisible) → B1 → B2 → B3 → B4
(commit: renderer routes but no UI — invisible) → B5 → B6 (commit: feature
visible) → C1 → C2 (commit: proven) → D (commit: docs). Four to five commits,
each independently green; any step can stop and ship without breaking main.
