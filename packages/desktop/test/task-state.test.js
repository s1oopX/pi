import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadTaskState, parseTaskState, saveTaskState } from "../src/task-state.js";

test("task state validates, saves atomically, and reloads resume metadata", (t) => {
	const root = mkdtempSync(join(tmpdir(), "pi-studio-task-state-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const path = join(root, "user-data", "tasks.json");
	const tasks = [{
		taskId: "task_7",
		cwd: "C:\\worktrees\\pi-7",
		branch: "task/pi-7",
		sourceRepo: "C:\\work\\pi",
		worktreePath: "C:\\worktrees\\pi-7",
		sessionFile: "C:\\sessions\\session.jsonl",
		unread: 3,
		completed: true,
	}];

	saveTaskState(path, tasks);
	assert.deepEqual(loadTaskState(path), { tasks });
	assert.equal(JSON.parse(readFileSync(path, "utf8")).version, 1);
});

test("invalid task state is reported without changing the original file", (t) => {
	const root = mkdtempSync(join(tmpdir(), "pi-studio-task-state-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const path = join(root, "tasks.json");
	const original = '{"version":2,"tasks":[]}\n';
	writeFileSync(path, original);

	const loaded = loadTaskState(path);
	assert.deepEqual(loaded.tasks, []);
	assert.match(loaded.error.message, /unsupported format/);
	assert.equal(readFileSync(path, "utf8"), original);
	assert.throws(() => parseTaskState('{"version":1,"tasks":[{"taskId":"main","cwd":"C:\\\\work"}]}'), /invalid record/);
	assert.throws(() => parseTaskState('{"version":1,"tasks":[{"taskId":"task_1","cwd":"C:\\\\work","unread":-1}]}'), /unread count/);
	assert.throws(() => parseTaskState('{"version":1,"tasks":[{"taskId":"task_1","cwd":"C:\\\\work","completed":"yes"}]}'), /completion flag/);
});

test("missing task state starts empty", (t) => {
	const root = mkdtempSync(join(tmpdir(), "pi-studio-task-state-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(root, { recursive: true });
	assert.deepEqual(loadTaskState(join(root, "missing.json")), { tasks: [] });
});

test("retains unavailable tasks alongside the live pool without unbounded state", () => {
	const tasks = Array.from({ length: 10 }, (_, index) => ({
		taskId: `task_${index + 1}`,
		cwd: `C:\\workspaces\\task-${index + 1}`,
	}));
	assert.equal(parseTaskState(JSON.stringify({ version: 1, tasks })).length, 10);
	assert.throws(
		() => parseTaskState(JSON.stringify({ version: 1, tasks: [...tasks, { taskId: "task_11", cwd: "C:\\work" }] })),
		/invalid task list/,
	);
});
