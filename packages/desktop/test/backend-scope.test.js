import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { findForbiddenBackendInputs } from "../src/backend-scope.js";

test("rejects generated catalogs and official OAuth implementations from the Studio backend", () => {
	const forbidden = findForbiddenBackendInputs([
		"packages/ai/dist/models.generated.js",
		"packages/ai/dist/providers/openrouter.models.js",
		"packages/ai/dist/image-models.generated.js",
		"packages/ai/dist/compat.js",
		"packages/ai/dist/utils/oauth/openai-codex.js",
		"packages/ai/dist/api/github-copilot-headers.js",
	]);
	assert.equal(forbidden.length, 6);
	assert.deepEqual(findForbiddenBackendInputs(["packages/ai/dist/custom-compat.js", "packages/ai/dist/custom-oauth.js"]), []);
});

test("desktop package builds and ships only its catalog-free backend", () => {
	const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
	assert.equal(packageJson.scripts["build:backend"], "node scripts/build-backend.mjs");
	assert.equal(packageJson.scripts["build:backend"].includes("build:binary"), false);
	const resources = packageJson.build.extraResources.find((entry) => entry.to === "pi-backend");
	assert.deepEqual(resources.filter, [
		"pi-studio-backend.exe",
		"photon_rs_bg.wasm",
		"package.json",
		"README.md",
		"docs/**/*",
		"examples/**/*",
		"export-html/**/*",
		"theme/**/*",
	]);
});

test("compiled Studio backend metafile contains no provider catalogs", { skip: !existsSync(join(import.meta.dirname, "../../coding-agent/dist/pi-studio-backend.meta.json")) }, () => {
	const path = join(import.meta.dirname, "../../coding-agent/dist/pi-studio-backend.meta.json");
	const metafile = JSON.parse(readFileSync(path, "utf8"));
	const inputs = Object.keys(metafile.inputs || {});
	assert.deepEqual(findForbiddenBackendInputs(inputs), []);
	assert.equal(inputs.some((input) => /custom-compat\.[cm]?[jt]s$/i.test(input)), true);
	assert.equal(inputs.some((input) => /custom-oauth\.[cm]?[jt]s$/i.test(input)), true);
});
