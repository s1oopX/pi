import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAutomationService, nextAutomationRun, parseRRule } from "../src/automations.js";

function tempWorkspace() {
	const root = mkdtempSync(join(tmpdir(), "pi-studio-automations-"));
	const workspace = join(root, "workspace");
	mkdirSync(workspace);
	return { root, workspace, statePath: join(root, "automations.json") };
}

test("RRULE parsing and next-run calculation cover the supported schedules", () => {
	assert.equal(
		parseRRule("rrule:FREQ=WEEKLY;BYDAY=FR,MO;BYHOUR=9;BYMINUTE=30").canonical,
		"FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,FR;BYHOUR=9;BYMINUTE=30",
	);

	const dailyAfter = new Date(2026, 6, 27, 8, 15).getTime();
	assert.equal(
		new Date(nextAutomationRun("FREQ=DAILY;BYHOUR=9;BYMINUTE=30", dailyAfter)).getTime(),
		new Date(2026, 6, 27, 9, 30).getTime(),
	);

	const fridayAfterRun = new Date(2026, 6, 31, 10, 0).getTime();
	assert.equal(
		new Date(nextAutomationRun("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0", fridayAfterRun)).getTime(),
		new Date(2026, 7, 3, 9, 0).getTime(),
	);

	assert.throws(() => parseRRule("FREQ=MONTHLY"), /FREQ must be/);
	assert.throws(() => parseRRule("FREQ=DAILY;BYDAY=MO"), /do not support BYDAY/);
});

test("automation runs persist their independent session history", async (t) => {
	const paths = tempWorkspace();
	t.after(() => rmSync(paths.root, { recursive: true, force: true }));
	let now = new Date(2026, 6, 29, 8, 0).getTime();
	const service = createAutomationService({
		filePath: paths.statePath,
		now: () => now,
		runAutomation: async () => ({ sessionId: "session-1", sessionFile: join(paths.root, "session.jsonl") }),
	});
	t.after(() => service.stop());

	const created = service.create({
		name: "Daily review",
		prompt: "Review the workspace",
		cwd: paths.workspace,
		rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
		notificationPolicy: "failures",
	});
	assert.equal(created.status, "active");
	assert.equal(created.notificationPolicy, "failures");
	assert.equal(created.runs.length, 0);

	now += 1000;
	service.runNow(created.id);
	await service.waitForIdle();
	const finished = service.list()[0];
	assert.equal(finished.lastRunStatus, "success");
	assert.equal(finished.runs[0].sessionId, "session-1");
	assert.equal(finished.runs[0].sessionFile, join(paths.root, "session.jsonl"));
	assert.equal(finished.runs[0].readAt, undefined);

	const read = service.updateRun(created.id, finished.runs[0].id, "read");
	assert.ok(read.runs[0].readAt);
	const unread = service.updateRun(created.id, finished.runs[0].id, "unread");
	assert.equal(unread.runs[0].readAt, undefined);
	const archived = service.updateRun(created.id, finished.runs[0].id, "archive");
	assert.ok(archived.runs[0].readAt);
	assert.ok(archived.runs[0].archivedAt);
	const restored = service.updateRun(created.id, finished.runs[0].id, "restore");
	assert.equal(restored.runs[0].archivedAt, undefined);
	service.updateRun(created.id, finished.runs[0].id, "archive");
	assert.throws(() => service.updateRun(created.id, finished.runs[0].id, "ignore"), /Run action must be/);

	const stored = JSON.parse(readFileSync(paths.statePath, "utf8"));
	assert.equal(stored.version, 1);
	assert.equal(stored.automations[0].runs[0].status, "success");
	assert.ok(stored.automations[0].runs[0].archivedAt);

	const reloaded = createAutomationService({
		filePath: paths.statePath,
		now: () => now,
		runAutomation: async () => ({}),
	});
	t.after(() => reloaded.stop());
	assert.equal(reloaded.list()[0].runs[0].sessionId, "session-1");
	assert.equal(reloaded.list()[0].notificationPolicy, "failures");
	assert.ok(reloaded.list()[0].runs[0].archivedAt);
});

test("due runs advance before execution and cannot start twice", async (t) => {
	const paths = tempWorkspace();
	t.after(() => rmSync(paths.root, { recursive: true, force: true }));
	let now = new Date(2026, 6, 29, 8, 0, 10).getTime();
	let executions = 0;
	let finishRun;
	const blocker = new Promise((resolve) => {
		finishRun = resolve;
	});
	const service = createAutomationService({
		filePath: paths.statePath,
		now: () => now,
		runAutomation: async () => {
			executions += 1;
			await blocker;
			return {};
		},
	});
	t.after(() => service.stop());

	const created = service.create({
		name: "Minute check",
		prompt: "Check now",
		cwd: paths.workspace,
		rrule: "FREQ=MINUTELY;INTERVAL=1",
	});
	now = Date.parse(created.nextRunAt);
	const first = service.runDue();
	const second = service.runDue();
	assert.equal(first.length, 1);
	assert.equal(second.length, 0);
	assert.equal(executions, 1);
	assert.ok(Date.parse(service.list()[0].nextRunAt) > now, "the next run is persisted before work starts");

	finishRun();
	await service.waitForIdle();
	assert.equal(service.list()[0].runs[0].status, "success");
});

test("pause, resume, edit, and delete validate state", (t) => {
	const paths = tempWorkspace();
	t.after(() => rmSync(paths.root, { recursive: true, force: true }));
	const service = createAutomationService({
		filePath: paths.statePath,
		runAutomation: async () => ({}),
	});
	t.after(() => service.stop());

	const created = service.create({
		name: "Weekly report",
		prompt: "Prepare the report",
		cwd: paths.workspace,
		rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0",
		status: "paused",
	});
	assert.equal(created.nextRunAt, null);
	assert.ok(service.setStatus(created.id, "active").nextRunAt);
	assert.equal(service.setStatus(created.id, "paused").nextRunAt, null);
	assert.throws(
		() => service.update(created.id, { ...created, cwd: join(paths.root, "missing") }),
		/Workspace not found/,
	);
	assert.equal(service.delete(created.id).id, created.id);
	assert.deepEqual(service.list(), []);
});
