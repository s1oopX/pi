# Parallel Tasks M3 — Same-Repo Worktree Isolation (TDD Plan)

Status: **LANDED 2026-07-26** · Prereq: M2 landed · Companion: `parallel-tasks-design.md` §3.3

Implementation note: the M2 create flow's `chooseWorkspace()` gate
(`changed:false` for both cancel and picking the current folder) silently
swallowed the same-folder pick — the e2e caught it; a dedicated
`dialog:pick-folder` IPC with an explicit cancel signal replaced it.

Goal: creating a parallel task in a folder that is already running (the
primary workspace or another task) no longer refuses — for git repositories it
transparently provisions `git worktree add -b task/<name>` under
`<userData>/worktrees/` and runs the task there. The branch lands through the
existing git panel; stopping the task removes a clean worktree and keeps a
dirty one. Non-git folders keep the M2 refusal.

Decisions:

1. **Automatic, not prompted.** Picking a claimed git folder just works; the
   task row labels itself with the branch. Simplest mental model.
2. **Worktree naming decouples from task ids.** Directory
   `<repoBasename>-<n>` (lowest free n) under the worktrees root; branch
   `task/<dirname>`, bumped past existing branches. The registry stays
   git-agnostic — it just gets `create(cwd, meta)` passthrough metadata.
3. **Stop policy:** wait for the backend process to exit (Windows file
   locks), then `git worktree remove` without `--force`; a dirty worktree is
   left in place and reported, never destroyed. `git worktree prune` runs
   before each add to absorb crashed leftovers.
4. **Git panel follows the active task (closes the M2 primary-only
   limitation).** All `git:*` / `workspace:get-git-status` /
   `workspace:list-files` / `workspace:reveal-path` IPC accepts the optional
   trailing taskId; the renderer api layer attaches the active task exactly as
   it does for `backend:*`. Without this the worktree branch could not be
   committed or PR'd from inside the app, which is the whole point.
5. **Known wart (documented, not fixed):** a worktree is a new path, so a
   trusted source repo's `.pi` resources arrive untrusted in the task until
   trusted once via the banner.

Increments (red → green each):

- **A. `src/git-worktree.js`** — `test/git-worktree.test.js` first:
  pickWorktreeName (lowest free slot), pickBranchName (collision bump via
  rev-parse probes), createTaskWorktree argv sequence (prune → add -b, no
  shell, validated names), removeTaskWorktree tolerating dirty/busy failures,
  isGitRepository. Fake exec/fs impls per the git-commit.test.js pattern.
- **B. Registry meta passthrough** — `create(cwd, meta)` echoed in
  snapshots/list; unit tests extended.
- **C. main.js wiring** — task:create branches on claimed+git; task:stop
  waits for exit then removes; git/workspace IPC gains taskId resolution.
  Covered by the e2e (Electron-bound).
- **D. Renderer** — TaskSnapshot/TaskSummary carry branch; ParallelTasks row
  shows a branch chip; api wrappers attach the active task to git/workspace
  calls. Vitest on the row mapping.
- **E. e2e `parallel-worktree.test.js`** — primary workspace is a real repo;
  create a task for the same folder; assert the worktree dir + `task/*`
  branch exist, the git panel (active = worktree task) reports the task
  branch, the primary tree stays untouched, stop removes the clean worktree
  and keeps the branch.
- **F. Docs** — README parallel-tasks section, design doc §3.3 marked landed,
  CHANGELOG.
