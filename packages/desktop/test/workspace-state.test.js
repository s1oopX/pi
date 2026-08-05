import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	loadStoredWorkspace,
	parseWorkspaceState,
	resolveStoredWorkspace,
	saveStoredWorkspace,
} from "../src/workspace-state.js";

test("parses only the supported workspace state shape", () => {
	assert.equal(parseWorkspaceState('{"version":1,"cwd":"C:\\\\code\\\\pi"}'), "C:\\code\\pi");
	assert.equal(parseWorkspaceState("not json"), undefined);
	assert.equal(parseWorkspaceState('{"version":2,"cwd":"C:\\\\code"}'), undefined);
	assert.equal(parseWorkspaceState('{"version":1,"cwd":""}'), undefined);
	assert.equal(parseWorkspaceState('[]'), undefined);
});

test("restores a parsed workspace only when it is still a directory", () => {
	const contents = '{"version":1,"cwd":"C:\\\\code\\\\pi"}';
	assert.equal(resolveStoredWorkspace(contents, (path) => path === "C:\\code\\pi"), "C:\\code\\pi");
	assert.equal(resolveStoredWorkspace(contents, () => false), undefined);
});

test("atomically saves and reloads a valid workspace", (t) => {
	const root = mkdtempSync(join(tmpdir(), "pi-studio-workspace-state-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const workspace = join(root, "workspace");
	const nextWorkspace = join(root, "next-workspace");
	const statePath = join(root, "user-data", "workspace-state.json");
	mkdirSync(workspace);
	mkdirSync(nextWorkspace);

	saveStoredWorkspace(statePath, workspace);
	assert.equal(loadStoredWorkspace(statePath), workspace);

	saveStoredWorkspace(statePath, nextWorkspace);
	assert.equal(loadStoredWorkspace(statePath), nextWorkspace);
	assert.deepEqual(readdirSync(join(root, "user-data")), ["workspace-state.json"]);
	assert.deepEqual(JSON.parse(readFileSync(statePath, "utf8")), { version: 1, cwd: nextWorkspace });

	const remoteWorkspace = "ssh://remote-one/~/code/pi";
	saveStoredWorkspace(statePath, remoteWorkspace);
	assert.equal(loadStoredWorkspace(statePath), remoteWorkspace);
});

test("ignores corrupt, oversized, and stale workspace state", (t) => {
	const root = mkdtempSync(join(tmpdir(), "pi-studio-workspace-state-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const statePath = join(root, "workspace-state.json");

	writeFileSync(statePath, "not json");
	assert.equal(loadStoredWorkspace(statePath), undefined);

	writeFileSync(statePath, "x".repeat(16 * 1024 + 1));
	assert.equal(loadStoredWorkspace(statePath), undefined);

	writeFileSync(statePath, JSON.stringify({ version: 1, cwd: join(root, "missing") }));
	assert.equal(loadStoredWorkspace(statePath), undefined);

	writeFileSync(statePath, JSON.stringify({ version: 1, cwd: "ssh://remote-one/work?invalid=1" }));
	assert.equal(loadStoredWorkspace(statePath), undefined);
	assert.throws(
		() => saveStoredWorkspace(statePath, "ssh://remote-one/work?invalid=1"),
		/Workspace not found/,
	);
});
