import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { BackendHandle } from "../src/backend-handle.js";

function fakeChild({ writeError } = {}) {
	const child = new EventEmitter();
	child.written = [];
	child.killed = false;
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	child.stdin = {
		writable: true,
		write(text, callback) {
			child.written.push(text);
			callback?.(writeError ?? undefined);
			return true;
		},
	};
	child.kill = () => {
		child.killed = true;
	};
	return child;
}

function createHandle(overrides = {}) {
	const events = [];
	const children = [];
	const notified = [];
	const sessionCwds = [];
	const handle = new BackendHandle({
		id: "test",
		getCwd: () => "C:\\work",
		getBackendPath: () => "C:\\backend.exe",
		sendToRenderer: (channel, payload) => events.push({ channel, payload }),
		onSessionChanged: (cwd) => sessionCwds.push(cwd),
		notify: (payload) => notified.push(payload),
		spawnImpl: (...args) => {
			const child = fakeChild(overrides.childOptions);
			child.spawnArgs = args;
			children.push(child);
			return child;
		},
		existsSyncImpl: overrides.existsSyncImpl ?? (() => true),
		...(overrides.nowImpl ? { nowImpl: overrides.nowImpl } : {}),
	});
	return { handle, events, children, notified, sessionCwds };
}

function replyTo(child, written, extra = {}) {
	const { id } = JSON.parse(written);
	child.stdout.emit("data", Buffer.from(`${JSON.stringify({ type: "response", id, success: true, ...extra })}\n`));
}

async function startReady(context) {
	context.handle.start();
	const child = context.children.at(-1);
	replyTo(child, child.written.at(-1)); // answer the init get_state ping
	await Promise.resolve();
	return child;
}

test("start spawns in the cwd, pings get_state, and reports ready with tagged statuses", async (t) => {
	const context = createHandle();
	t.after(() => context.handle.stop());

	const child = await startReady(context);
	assert.equal(child.spawnArgs[0], "C:\\backend.exe");
	assert.equal(child.spawnArgs[2].cwd, "C:\\work");
	assert.equal(child.spawnArgs[2].env.PI_DESKTOP, "1");
	assert.equal(JSON.parse(child.written[0]).type, "get_state");

	const statuses = context.events.filter((event) => event.channel === "backend:status");
	assert.deepEqual(statuses.map((event) => [event.payload.ready, event.payload.backendId]), [
		[false, "test"],
		[true, "test"],
	]);
	assert.equal(context.handle.statusSnapshot().ready, true);
	assert.equal(context.handle.statusSnapshot().backendId, "test");
});

test("request writes JSONL, honors caller-supplied ids, and resolves on the response line", async (t) => {
	const context = createHandle();
	t.after(() => context.handle.stop());
	const child = await startReady(context);

	const pending = context.handle.request({ type: "bash", command: "ls", id: "bash_7" });
	const written = JSON.parse(child.written.at(-1));
	assert.equal(written.id, "bash_7");
	replyTo(child, child.written.at(-1), { data: { ok: 1 } });
	const response = await pending;
	assert.deepEqual(response.data, { ok: 1 });

	const assigned = context.handle.request({ type: "get_state" });
	assert.match(JSON.parse(child.written.at(-1)).id, /^desktop_\d+$/u);
	replyTo(child, child.written.at(-1));
	await assigned;
});

test("request rejects when not running, and while starting without allowStarting", async (t) => {
	const context = createHandle();
	t.after(() => context.handle.stop());

	await assert.rejects(context.handle.request({ type: "get_state" }), /not running/);
	context.handle.start();
	await assert.rejects(context.handle.request({ type: "get_state" }), /is starting/);
});

test("request times out and clears its pending slot", async (t) => {
	const context = createHandle();
	t.after(() => context.handle.stop());
	await startReady(context);

	await assert.rejects(
		context.handle.request({ type: "get_messages" }, { timeoutMs: 10 }),
		/Timed out waiting for get_messages/,
	);
	assert.equal(context.handle.pendingRequests.size, 0);
});

test("stdout reassembles split lines, tags events, and routes hooks", async (t) => {
	const context = createHandle();
	t.after(() => context.handle.stop());
	const child = await startReady(context);
	const eventCountBefore = context.events.filter((event) => event.channel === "backend:event").length;

	child.stdout.emit("data", Buffer.from('{"type":"agent_'));
	child.stdout.emit("data", Buffer.from('end"}\n{"type":"session_changed","cwd":"D:\\\\next"}\nnot json\n'));

	const backendEvents = context.events.filter((event) => event.channel === "backend:event").slice(eventCountBefore);
	assert.deepEqual(
		backendEvents.map((event) => [event.payload.type, event.payload.backendId]),
		[["agent_end", "test"], ["session_changed", "test"]],
	);
	assert.deepEqual(context.notified.map((payload) => payload.type), ["agent_end", "session_changed"]);
	assert.deepEqual(context.sessionCwds, ["D:\\next"]);
	const log = context.events.findLast((event) => event.channel === "backend:log");
	assert.equal(log.payload.message, "not json");
	assert.equal(log.payload.backendId, "test");
});

test("exit rejects pending requests and schedules a restart with backoff", async (t) => {
	const context = createHandle();
	t.after(() => context.handle.stop());
	const child = await startReady(context);

	const pending = context.handle.request({ type: "get_messages" });
	child.stderr.emit("data", Buffer.from("boom"));
	child.emit("exit", 1, null);

	await assert.rejects(pending, /exited code=1.*boom/su);
	const status = context.events.findLast((event) => event.channel === "backend:status");
	assert.equal(status.payload.restarting, true);
	assert.equal(status.payload.retryInMs, 1000);
	assert.ok(context.handle.restartTimer, "a restart should be scheduled");
	assert.equal(context.handle.statusSnapshot().restarting, true);
});

test("gives up after the restart budget with a final error status", async (t) => {
	const context = createHandle();
	t.after(() => context.handle.stop());
	const child = await startReady(context);

	context.handle.restartAttempts = 3;
	child.emit("exit", 1, null);

	const status = context.events.findLast((event) => event.channel === "backend:status");
	assert.match(status.payload.error, /stopped after 3 restart attempts/);
	assert.equal(context.handle.restartTimer, undefined);
});

test("stop kills the child, rejects pending work, and suppresses the restart path", async (t) => {
	const context = createHandle();
	const child = await startReady(context);

	const pending = context.handle.request({ type: "get_messages" });
	context.handle.stop();
	await assert.rejects(pending, /Pi backend stopped/);
	assert.equal(child.killed, true);

	const statusCountBefore = context.events.filter((event) => event.channel === "backend:status").length;
	child.emit("exit", 0, null); // late exit from the killed child
	const statusCountAfter = context.events.filter((event) => event.channel === "backend:status").length;
	assert.equal(statusCountAfter, statusCountBefore, "a stopped handle must not schedule restarts");
	assert.equal(context.handle.restartTimer, undefined);
});

test("a failed init ping reports the failure and kills the child", async (t) => {
	const context = createHandle({ childOptions: { writeError: new Error("EPIPE") } });
	t.after(() => context.handle.stop());

	context.handle.start();
	const child = context.children.at(-1);
	await Promise.resolve();
	await Promise.resolve();

	const status = context.events.findLast((event) => event.channel === "backend:status");
	assert.match(status.payload.error, /failed to initialize: EPIPE/);
	assert.equal(child.killed, true);
});

test("tracks backend activity for idle detection", async (t) => {
	let now = 1000;
	const context = createHandle({ nowImpl: () => now });
	t.after(() => context.handle.stop());
	const child = await startReady(context);
	const readyActivity = context.handle.lastActivityAt;
	assert.ok(readyActivity >= 1000, "the ready handshake counts as activity");

	now = 5000;
	const pending = context.handle.request({ type: "get_messages" });
	assert.equal(context.handle.lastActivityAt, 5000, "an outgoing request bumps activity");

	now = 9000;
	replyTo(child, child.written.at(-1));
	await pending;
	assert.equal(context.handle.lastActivityAt, 9000, "a parsed stdout line bumps activity");

	now = 12000;
	child.stdout.emit("data", Buffer.from('{"type":"agent_start"}\n'));
	assert.equal(context.handle.lastActivityAt, 12000, "streamed events bump activity");
});

test("a missing executable reports a tagged error without spawning", (t) => {
	const context = createHandle({ existsSyncImpl: () => false });
	t.after(() => context.handle.stop());

	context.handle.start();
	assert.equal(context.children.length, 0);
	const status = context.events.findLast((event) => event.channel === "backend:status");
	assert.match(status.payload.error, /Pi backend not found/);
	assert.equal(status.payload.backendId, "test");
});
