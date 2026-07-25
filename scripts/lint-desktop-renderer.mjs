// Lint the Pi Studio renderer, which the repo-wide biome config does not cover.
//
// `biome.json` includes only `packages/*/src/**/*.ts`: that misses .tsx files and
// does not reach the two-level `packages/desktop/renderer-next/src` path. Adding
// the renderer to the shared config is not worth it — the repo `check` script runs
// `biome check --write`, which would reformat ~120 renderer files to the 3-wide-tab
// repo style and bury real diffs in noise.
//
// So this lints the renderer through a temporary config with the formatter off,
// leaving the renderer's own 2-space formatting untouched.
//
//   npm run lint:desktop-renderer
//
// Rules disabled below do not fit this codebase; each has a reason. Everything
// else stays on, including the a11y rules that caught real defects (an
// aria-label on a roleless div is silently ignored by screen readers).

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rendererDir = join(repoRoot, "packages", "desktop", "renderer-next", "src");
// biome resolves relative `includes` against the config file's directory, and the
// config lives in a temp dir here, so the glob has to be absolute.
const rendererGlob = `${rendererDir.replaceAll("\\", "/")}/**`;

const config = {
	$schema: "https://biomejs.dev/schemas/2.3.5/schema.json",
	// The renderer uses 2-space indent and its own line widths; never let biome
	// rewrite it to the repo's tab style.
	formatter: { enabled: false },
	linter: {
		enabled: true,
		rules: {
			recommended: true,
			a11y: {
				// Suggests <button> over role="button" and similar. The roles this app
				// needs (status, group, separator) have no semantic HTML equivalent.
				useSemanticElements: "off",
				// Decorative icons are correctly marked aria-hidden; adding <title>
				// would make them announce instead of staying silent.
				noSvgWithoutTitle: "off",
				// autoFocus is appropriate for a desktop app's dialogs and pickers.
				noAutofocus: "off",
				// Menus and listboxes here use roving tabindex: children carry
				// tabIndex={-1} and the container handles onKeyDown, which is
				// ARIA-conformant even though the container is not focusable.
				useFocusableInteractive: "off",
				useAriaPropsForRole: "off",
				// Backdrops close via Escape handlers on the panel, and <dialog>
				// carries native keyboard semantics.
				noStaticElementInteractions: "off",
				useKeyWithClickEvents: "off",
			},
			complexity: {
				// !important is load-bearing here: inside prefers-reduced-motion
				// blocks, and to override third-party styles (shiki, xterm).
				noImportantStyles: "off",
			},
			correctness: {
				// Hooks intentionally depend on specific fields (token?.query) rather
				// than whole objects, to avoid re-running on identity churn.
				useExhaustiveDependencies: "off",
			},
			style: {
				// Matches the repo-wide config.
				noNonNullAssertion: "off",
				// Selector ordering only; the cascade here is deliberate.
				noDescendingSpecificity: "off",
			},
			suspicious: {
				noExplicitAny: "off",
				// Sanitizers match control characters on purpose, the same reason the
				// repo-wide config disables this rule.
				noControlCharactersInRegex: "off",
				// `(groups[key] ??= []).push(x)` is a deliberate, correct idiom.
				noAssignInExpressions: "off",
				// Arrow callbacks implicitly returning a void call are harmless.
				useIterableCallbackReturn: "off",
			},
		},
	},
	files: { includes: [rendererGlob] },
};

const configDir = mkdtempSync(join(tmpdir(), "pi-renderer-lint-"));
try {
	writeFileSync(join(configDir, "biome.json"), JSON.stringify(config, null, 2));
	const result = spawnSync(
		process.execPath,
		[
			join(repoRoot, "node_modules", "@biomejs", "biome", "bin", "biome"),
			"lint",
			`--config-path=${configDir}`,
			"--max-diagnostics=200",
			rendererDir,
		],
		{ stdio: "inherit", cwd: repoRoot },
	);
	if (result.error) {
		console.error(`Failed to run biome: ${result.error.message}`);
		process.exit(1);
	}
	process.exit(result.status ?? 1);
} finally {
	rmSync(configDir, { recursive: true, force: true });
}
