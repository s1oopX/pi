# Changelog

Pi Studio is a private workspace package: it is not published to npm, and its
version tracks the monorepo's lockstep releases. Entries below cover the desktop
client (Electron main process and the `renderer-next` React renderer).

## [Unreleased]

### Added

- Live tool output: while the agent runs a tool, the tool card streams the output tail in real time (`tool_execution_update` snapshots), and the workbench terminal streams direct bash output chunk by chunk (`bash_execution_update` correlated by request id) instead of printing everything at the end.
- The thinking-level picker now offers `max` on models that support it.
- Git commit flow on the top bar: the branch button opens a popover listing working-tree changes (first 200, status-colored) with a commit message box and a "Commit all changes" action (`git add --all` + `git commit -m`, no shell, Ctrl+Enter to submit). Committing is blocked while the agent is running.
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
