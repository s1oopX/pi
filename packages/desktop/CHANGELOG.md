# Changelog

Pi Studio is a private workspace package: it is not published to npm, and its
version tracks the monorepo's lockstep releases. Entries below cover the desktop
client (Electron main process and the `renderer-next` React renderer).

## [Unreleased]

### Added

- Trusted-folder management in Settings → Resources: a "Trusted folders" section lists every saved trust decision (trusted or refused, with the entry covering the current workspace flagged) and lets you remove one. Removing a decision that covers the open workspace recomputes effective trust with the same rule the backend boots with and hot-reloads, so revoking trust immediately unloads the project's extensions and brings the trust banner back. Backed by new `get_project_trust_entries` / `set_project_trust_entry` RPC commands (allowlisted in the main process) and a `ProjectTrustStore.list()` accessor; the project-trust e2e now also revokes from Settings and asserts the banner returns.
- Pull requests from the git panel: a PR button next to Push opens a form that resolves head → base (remote default branch, falling back to `main`/`master`), prefills the title from the last commit subject, and creates the PR through the GitHub CLI (`gh pr create`, non-interactive, explicit `--repo/--head/--base`, no shell). When `gh` is not installed the panel opens the pre-filled GitHub compare page in the browser instead; either way the resulting page opens externally. Creation requires a pushed branch and a GitHub `origin` (https/ssh/scp remote forms all parse, GHE hosts included); on a non-GitHub remote the form explains instead of offering actions. Covered by unit tests (remote parsing, compare URLs, exact `gh` argv, missing-gh fallback) and e2e assertions on the resolved head/base context.
- Project trust: Pi Studio no longer auto-trusts every folder it opens. pi trusts projects by default, which would run a folder's `.pi` extensions and project settings with full access the moment you open it — so opening a downloaded repository could execute its code. Studio now keeps folders that carry project-local resources untrusted until you explicitly trust them: their extensions and settings stay disabled, and an untrusted-folder banner offers a "Trust folder" action that persists the decision (`<agentDir>/trust.json`) and hot-reloads. Backed by a new `set_project_trust` RPC command, `projectTrusted`/`projectTrustRequired` in session state, unit tests, and an e2e that proves a project extension does not run until the folder is trusted.
- Bundled a tool-approval extension so the permission-mode selector actually enforces tool access. pi has no built-in permission system; previously the full/auto/ask selector set a flag that nothing read, and the settings panel warned the extension was missing. The Studio backend now injects an inline extension that registers the `permission-mode` flag and gates tool calls: `full` runs everything, `auto` asks before risky bash (destructive/privileged/remote-code) and writes outside the workspace, `ask` asks before every command and file change. Denials surface as native inline approval dialogs and block the tool end to end. Covered by unit tests and an e2e test that denies a command and asserts it never ran.
- Live tool output: while the agent runs a tool, the tool card streams the output tail in real time (`tool_execution_update` snapshots), and the workbench terminal streams direct bash output chunk by chunk (`bash_execution_update` correlated by request id) instead of printing everything at the end.
- The thinking-level picker now offers `max` on models that support it.
- Git panel on the top bar: the branch button opens a panel with the full local git flow — working-tree changes (first 200, status-colored), commit-all (`git add --all` + `git commit -m`, Ctrl+Enter), push (auto `--set-upstream origin <branch>` on first push), an ahead/behind badge, and branch switching and creation. All git runs through `execFile` with no shell; branch names are validated so they can never be read as flags. Committing and branch operations are blocked while the agent is running. Covered by unit tests (fake `execFile`) and an e2e that creates a branch and pushes to a local bare remote. Extracted from the top bar into a dedicated `GitPanel` component.
- A tool-loop e2e test: the faux provider returns a bash `tool_calls` step, and the test asserts the running tool card shows the live output tail mid-run before the final reply lands. E2e setup now lives in a shared harness (`test/e2e/harness.mjs`).

- Added a shared `Icon` component as the single source of truth for line icons, with every glyph authored in a 24x24 box at a common stroke weight.
- Added `npm run lint:desktop-renderer`, an audit that lints the renderer through a temporary biome config. The repo-wide config does not reach `packages/desktop/renderer-next/src`, so this covers the gap without reformatting the renderer.
- Added `npm run pack:offline` in `packages/desktop`, which builds the renderer, compiles the backend, and packages an unpacked app without needing `npx` or network access.
- Added a CI job that type-checks, lints, and builds the renderer. The root `tsconfig.json` globs `packages/*/src`, which misses the renderer's two-level path, so `tsgo --noEmit` never covered these files.
- Added a workbench terminal command history.
- Added collapsible per-file diffs with change statistics.
- Added a turn summary, message metadata, and edit-and-resend on user messages.
- Added approval history and elevated-risk framing for inline approvals.
- Added live agent status on the active turn.
- Added path reveal actions, sticky statistics, and refresh guards.
- Surfaced backend `extension_error` events as an error toast and a log entry. Extension failures were previously silent in the desktop client.
- Added a main-process allowlist for renderer backend commands: `backend:request` only forwards the renderer's typed command set, and `backend:send` only accepts `extension_ui_response`.
- Added an end-to-end smoke test (`npm run test:e2e`): drives the real Electron app and the compiled backend through a prompt round-trip against a faux OpenAI-compatible provider on 127.0.0.1, with workspace, agent config, and Electron profile state fully isolated in a temp directory. The `Desktop E2E` CI workflow packages the offline Windows build and runs the smoke on a Windows runner.
- Added the `PI_STUDIO_USER_DATA_DIR` environment override, which relocates Electron `userData` (window and workspace state, renderer `localStorage`, the single-instance lock) so tests never touch the real profile.

### Changed

- Synced the fork with upstream pi-mono v0.82.1 (previously a v0.80.3-era snapshot) and ported the desktop surface to the ModelRuntime era: desktop RPC auth and custom-model commands now go through `session.modelRuntime` and the runtime credential store; `backend.ts` builds a catalog-free `ModelRuntime` (models.json only, no network catalog refresh); a new `custom-providers-all` build alias keeps generated catalogs and official gateway providers out of the Studio bundle; the models.json provider-level `env` (proxy setting) is restored in the 0.82 schema and auth composition; the wire contract gains the `max` thinking level. The upgrade unlocks `bash_execution_update` streaming, `get_available_thinking_levels`, `agent_settled`, and summarization retry events for upcoming desktop features.
- Reworked settings into a card-based layout with per-section icons.
- Moved the palette to pure neutrals with neutral selection states, warm region layering, and soft elevation with a rounded shell.
- Replaced 67 hand-inlined SVGs across 18 files with the shared `Icon` component, removing four competing viewBox sizes and eight stroke weights.
- Raised `--muted` to 60% opacity so 11px metadata text meets the WCAG AA 4.5:1 contrast ratio.
- Added a pressed-state scale to icon buttons and the empty-state call to action.
- Presented the agent process in a Codex-like style, including file changes with diff previews.
- Revealing a path in the file manager now refuses paths outside the current workspace instead of only flagging them, and the failure toast includes the underlying reason.

### Fixed

- Fixed `aria-label` on 12 elements that had no semantic role. Screen readers ignore those labels, so the announcements never happened — including two `aria-live` regions meant to report agent status.
- Fixed an invalid `role="note"` and four `role="img"` elements that do not support `aria-label`.
- Fixed two `<label>` elements that wrapped no form control, which misleads screen readers into expecting one.
- Fixed settings leave guards and capability checks.
- Fixed thread list reloading on workspace switch, and stabilized workspace switching state.
- Fixed empty project thread controls appearing with no threads.
- Skipped redundant message-row re-renders while streaming.
- Fixed a corrupted Simplified Chinese translation on the model configuration import checkbox.

### Removed

- Removed the unused `workspaceSwitchPhase` store module (the sidebar implements the switch narrative inline) and the empty `ExtensionApproval` component directory.
