import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCatalogFreeBackendInputs } from "../src/backend-scope.js";

const desktopDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(desktopDir));
const npmCliPath = process.env.npm_execpath;
const bunCommand = process.platform === "win32" ? "bun.exe" : "bun";

if (!npmCliPath) {
	throw new Error("npm_execpath is unavailable; run this script through the desktop npm package");
}

function run(command, args) {
	const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} exited with code ${result.status}`);
	}
}

const outputPath = join(repoRoot, "packages/coding-agent/dist/pi-studio-backend.exe");
const metafilePath = join(repoRoot, "packages/coding-agent/dist/pi-studio-backend.meta.json");
run(bunCommand, [join(repoRoot, "packages/desktop/scripts/compile-backend.ts")]);

const metafile = JSON.parse(readFileSync(metafilePath, "utf8"));
const inputs = Object.keys(metafile.inputs || {});
if (!inputs.some((input) => /custom-compat\.[cm]?[jt]s$/i.test(input))) {
	throw new Error("Pi Studio backend did not resolve the catalog-free compatibility entrypoint");
}
if (!inputs.some((input) => /custom-oauth\.[cm]?[jt]s$/i.test(input))) {
	throw new Error("Pi Studio backend did not resolve the catalog-free OAuth entrypoint");
}
assertCatalogFreeBackendInputs(inputs);

run(process.execPath, [npmCliPath, "--prefix", "packages/coding-agent", "run", "copy-binary-assets"]);
console.log(`Built catalog-free Pi Studio backend: ${outputPath}`);
