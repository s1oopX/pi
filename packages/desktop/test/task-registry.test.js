import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import { createTaskRegistry } from "../src/task-registry.js";

function fakeHandle(id, cwd) {
	return {
		id,
		getCwd: () => cwd,
		ready: false,
		starting: false,
		started: 0,
		stopped: 0,
		start() {
			this.started += 1;
			this.starting = true;
		},
		stop() {
			this.stopped += 1;
			this.ready = false;
			this.starting = false;
		},
	};
}

const primaryCwd = resolve("workspace-primary");

function createFixture({ maxTasks } = {}) {
	const created = [];
	const primary = fakeHandle("main", primaryCwd);
	primary.ready = true;
	const registry = createTaskRegistry({
		primary,
		createHandle: (id, cwd) => {
			const handle = fakeHandle(id, cwd);
			created.push(handle);
			return handle;
		},
		...(maxTasks === undefined ? {} : { maxTasks }),
	});
	return { registry, primary, created };
}

function poolCwd(name) {
	return join(resolve("pool"), name);
}

test("creates tasks up to the cap with stable unique ids and starts each handle once", () => {
	const { registry, created } = createFixture();
	const first = registry.create(poolCwd("a"));
	const second = registry.create(poolCwd("b"));
	const third = registry.create(poolCwd("c"));
	assert.deepEqual([first.taskId, second.taskId, third.taskId], ["task_1", "task_2", "task_3"]);
	assert.equal(created.length, 3);
	assert.deepEqual(created.map((handle) => handle.started), [1, 1, 1]);
	assert.deepEqual(created.map((handle) => handle.getCwd()), [poolCwd("a"), poolCwd("b"), poolCwd("c")]);
});

test("refuses creation at the cap and lists the running tasks in the error", () => {
	const { registry } = createFixture();
	registry.create(poolCwd("a"));
	registry.create(poolCwd("b"));
	assert.doesNotThrow(() => registry.assertCapacity());
	registry.create(poolCwd("c"));
	assert.throws(() => registry.assertCapacity(), /task limit/iu);
	assert.throws(
		() => registry.create(poolCwd("d")),
		(error) => {
			assert.match(error.message, /task limit/iu);
			assert.match(error.message, /task_1/u);
			assert.match(error.message, /task_3/u);
			return true;
		},
	);
});

test("honors a custom cap", () => {
	const { registry } = createFixture({ maxTasks: 1 });
	registry.create(poolCwd("a"));
	assert.throws(() => registry.create(poolCwd("b")), /task limit/iu);
});

test("refuses a cwd already claimed by a running task or the primary workspace", () => {
	const { registry } = createFixture();
	registry.create(poolCwd("a"));
	assert.throws(() => registry.create(poolCwd("a")), /already running/iu);
	assert.throws(() => registry.create(primaryCwd), /already running|primary workspace/iu);
	assert.equal(registry.isClaimed(poolCwd("a")), true);
	assert.equal(registry.isClaimed(poolCwd("free")), false);
});

test("get resolves the primary by default, entries by id, and throws on unknown ids", () => {
	const { registry, primary, created } = createFixture();
	registry.create(poolCwd("a"));
	assert.equal(registry.get(undefined).handle, primary);
	assert.equal(registry.get("main").handle, primary);
	assert.equal(registry.get("task_1").handle, created[0]);
	assert.throws(() => registry.get("task_99"), /Unknown task/u);
});

test("stop stops and removes a pool task but refuses the primary", () => {
	const { registry, created } = createFixture();
	registry.create(poolCwd("a"));
	registry.stop("task_1");
	assert.equal(created[0].stopped, 1);
	assert.throws(() => registry.get("task_1"), /Unknown task/u);
	assert.throws(() => registry.stop("main"), /primary/iu);
	// A freed slot and cwd can be reused.
	const reborn = registry.create(poolCwd("a"));
	assert.equal(reborn.taskId, "task_2");
});

test("list returns live snapshots with the primary first", () => {
	const { registry, primary, created } = createFixture();
	registry.create(poolCwd("a"));
	created[0].ready = true;
	created[0].starting = false;
	primary.starting = false;
	const listed = registry.list();
	assert.deepEqual(listed, [
		{ taskId: "main", cwd: primaryCwd, isPrimary: true, ready: true, starting: false },
		{ taskId: "task_1", cwd: poolCwd("a"), isPrimary: false, ready: true, starting: false },
	]);
});

test("passes worktree metadata through to snapshots and list entries", () => {
	const { registry } = createFixture();
	const created = registry.create(poolCwd("wt"), {
		branch: "task/my-app-1",
		sourceRepo: primaryCwd,
		worktreePath: poolCwd("wt"),
	});
	assert.equal(created.branch, "task/my-app-1");
	assert.equal(created.sourceRepo, primaryCwd);
	const listed = registry.list().find((entry) => entry.taskId === created.taskId);
	assert.equal(listed.branch, "task/my-app-1");
	assert.equal(registry.get(created.taskId).meta.worktreePath, poolCwd("wt"));
	// Entries without metadata stay unchanged in shape.
	const plain = registry.create(poolCwd("plain"));
	assert.equal(plain.branch, undefined);
});

test("stopAll stops the primary and every pool member", () => {
	const { registry, primary, created } = createFixture();
	registry.create(poolCwd("a"));
	registry.create(poolCwd("b"));
	registry.stopAll();
	assert.equal(primary.stopped, 1);
	assert.deepEqual(created.map((handle) => handle.stopped), [1, 1]);
});
