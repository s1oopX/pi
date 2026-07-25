# Changelog

Pi Studio is a private workspace package: it is not published to npm, and its
version tracks the monorepo's lockstep releases. Entries below cover the desktop
client (Electron main process and the `renderer-next` React renderer).

## [Unreleased]

### Added

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

### Changed

- Reworked settings into a card-based layout with per-section icons.
- Moved the palette to pure neutrals with neutral selection states, warm region layering, and soft elevation with a rounded shell.
- Replaced 67 hand-inlined SVGs across 18 files with the shared `Icon` component, removing four competing viewBox sizes and eight stroke weights.
- Raised `--muted` to 60% opacity so 11px metadata text meets the WCAG AA 4.5:1 contrast ratio.
- Added a pressed-state scale to icon buttons and the empty-state call to action.
- Presented the agent process in a Codex-like style, including file changes with diff previews.

### Fixed

- Fixed `aria-label` on 12 elements that had no semantic role. Screen readers ignore those labels, so the announcements never happened — including two `aria-live` regions meant to report agent status.
- Fixed an invalid `role="note"` and four `role="img"` elements that do not support `aria-label`.
- Fixed two `<label>` elements that wrapped no form control, which misleads screen readers into expecting one.
- Fixed settings leave guards and capability checks.
- Fixed thread list reloading on workspace switch, and stabilized workspace switching state.
- Fixed empty project thread controls appearing with no threads.
- Skipped redundant message-row re-renders while streaming.
