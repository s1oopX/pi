import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { assertPrerequisites, launchStudio, LAUNCH_TIMEOUT_MS, REPLY_TIMEOUT_MS } from "./harness.mjs";

const AUTOMATION_PROMPT = "AUTOMATION_TEMPLATE_PROMPT: summarize this workspace";
const AUTOMATION_REPLY = "Automation reply from faux provider.";

test("automations: create a worktree task, run it, persist settings, and reopen its session", async (t) => {
	assertPrerequisites();

	const studio = await launchStudio({
		reply: AUTOMATION_REPLY,
		setupWorkspace: (workspaceDir, tempRoot) => {
			const promptsDir = join(tempRoot, "agent", "prompts");
			mkdirSync(promptsDir, { recursive: true });
			writeFileSync(
				join(promptsDir, "automation-summary.md"),
				`---\ndescription: Summarize the current workspace\n---\n${AUTOMATION_PROMPT}\n`,
			);
			writeFileSync(join(workspaceDir, "README.md"), "# automation workspace\n");
			execFileSync("git", ["init"], { cwd: workspaceDir });
			execFileSync("git", ["config", "user.email", "pi-studio@example.invalid"], { cwd: workspaceDir });
			execFileSync("git", ["config", "user.name", "Pi Studio E2E"], { cwd: workspaceDir });
			execFileSync("git", ["add", "README.md"], { cwd: workspaceDir });
			execFileSync("git", ["commit", "-m", "initial"], { cwd: workspaceDir });
		},
	});
	t.after(() => studio.close());

	try {
		await studio.waitUntilReady();
		await studio.page.locator(".sidebar-automations-button").click();
		await studio.page.locator(".automations-page").waitFor({ state: "visible" });

		await studio.page.locator(".automations-new").click();
		const form = studio.page.locator("#automation-editor-form");
		await form.locator('[name="name"]').fill("Workspace summary");
		await form.locator('[name="template"]').selectOption("automation-summary");
		assert.equal(await form.locator('[name="prompt"]').inputValue(), "/automation-summary");
		await form.locator('[name="destination"]').selectOption("worktree");
		await form.locator('[name="model"]').selectOption({ label: "Faux 1 — faux" });
		await form.locator('[name="schedule"]').selectOption("weekly");
		await form.locator('[name="scheduleInterval"]').fill("2");
		await form.locator('[name="scheduleWeekday"]').selectOption("FR");
		await form.locator('[name="scheduleTime"]').fill("16:30");
		await form.locator('[name="notificationPolicy"]').selectOption("failures");
		await studio.page.locator('.automation-editor-dialog button[type="submit"]').click();

		const card = studio.page.locator(".automation-card").filter({ hasText: "Workspace summary" });
		await card.waitFor({ state: "visible" });
		const created = JSON.parse(readFileSync(join(studio.tempRoot, "user-data", "automations.json"), "utf8"));
		assert.equal(created.automations[0].destination, "worktree");
		assert.equal(created.automations[0].model.id, "faux-1");
		assert.equal(created.automations[0].rrule, "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;BYHOUR=16;BYMINUTE=30");
		assert.ok(created.automations[0].worktree.branch.startsWith("task/"));
		assert.ok(existsSync(created.automations[0].worktree.path), "automation worktree was not provisioned");
		await card.locator(".automation-run-now").click();
		await card.locator(".automation-run-status.success").first().waitFor({ state: "visible", timeout: REPLY_TIMEOUT_MS });
		await card.locator(".automation-unread-count").waitFor({ state: "visible" });

		assert.ok(
			studio.server.requests.some((request) => JSON.stringify(request.body?.messages ?? []).includes(AUTOMATION_PROMPT)),
			"automation prompt did not reach the faux provider",
		);
		await card.locator(".automation-history summary").click();
		await card.locator(".automation-run-archive").click();
		await studio.page.locator(".automations-run-filter-archived").click();
		await card.locator(".automation-run-restore").waitFor({ state: "visible" });
		const stored = JSON.parse(readFileSync(join(studio.tempRoot, "user-data", "automations.json"), "utf8"));
		assert.equal(stored.automations[0].notificationPolicy, "failures");
		assert.equal(stored.automations[0].runs[0].status, "success");
		assert.ok(stored.automations[0].runs[0].readAt, "archived run was not marked read");
		assert.ok(stored.automations[0].runs[0].archivedAt, "automation run was not archived");
		assert.ok(stored.automations[0].runs[0].sessionFile, "automation run did not retain a session file");

		await card.locator(".automation-open-run").click();
		await studio.page.locator(".automations-page").waitFor({ state: "detached", timeout: REPLY_TIMEOUT_MS });
		await studio.page.getByText(AUTOMATION_REPLY).first().waitFor({ state: "visible", timeout: REPLY_TIMEOUT_MS });
	} catch (error) {
		await studio.dumpDiagnostics();
		throw error;
	}
});

test("automations: heartbeat continues the trusted current conversation", async (t) => {
	assertPrerequisites();

	const heartbeatPrompt = "HEARTBEAT_PROMPT: continue this conversation";
	const heartbeatReply = "Heartbeat reply from faux provider.";
	const permissionCommand = "echo heartbeat-permission-restore";
	const permissionReply = "Permission restore confirmed.";
	const studio = await launchStudio({
		script: [
			{ reply: heartbeatReply },
			{ toolCalls: [{ id: "call_permission_restore", name: "bash", arguments: { command: permissionCommand } }] },
			{ reply: permissionReply },
		],
	});
	t.after(() => studio.close());

	try {
		await studio.waitUntilReady();
		const initialState = await studio.page.evaluate(async () => window.piDesktop?.request({ type: "get_state" }));
		assert.ok(initialState?.sessionId);
		assert.ok(initialState?.sessionFile);

		await studio.page.locator(".sidebar-automations-button").click();
		await studio.page.locator(".automations-new").click();
		const form = studio.page.locator("#automation-editor-form");
		await form.locator('[name="name"]').fill("Conversation heartbeat");
		await form.locator('[name="kind"]').selectOption("heartbeat");
		await form.locator('[name="prompt"]').fill(heartbeatPrompt);
		await form.locator('[name="schedule"]').selectOption("hourly");
		await studio.page.locator('.automation-editor-dialog button[type="submit"]').click();

		const card = studio.page.locator(".automation-card").filter({ hasText: "Conversation heartbeat" });
		await card.waitFor({ state: "visible" });
		await card.locator(".automation-run-now").click();
		await card.locator(".automation-run-status.success").first().waitFor({ state: "visible", timeout: REPLY_TIMEOUT_MS });

		const stored = JSON.parse(readFileSync(join(studio.tempRoot, "user-data", "automations.json"), "utf8"));
		assert.equal(stored.automations[0].kind, "heartbeat");
		assert.equal(stored.automations[0].destination, "local");
		assert.equal(stored.automations[0].thread.sessionId, initialState.sessionId);
		assert.equal(stored.automations[0].thread.sessionFile, initialState.sessionFile);
		assert.equal(stored.automations[0].runs[0].sessionFile, initialState.sessionFile);
		assert.ok(
			studio.server.requests.some((request) => JSON.stringify(request.body?.messages ?? []).includes(heartbeatPrompt)),
			"heartbeat prompt did not reach the faux provider",
		);

		await card.locator(".automation-history summary").click();
		await card.locator(".automation-open-run").click();
		await studio.page.locator(".automations-page").waitFor({ state: "detached", timeout: REPLY_TIMEOUT_MS });
		await studio.page.getByText(heartbeatReply).first().waitFor({ state: "visible", timeout: REPLY_TIMEOUT_MS });

		await studio.sendPrompt("Verify the restored permission mode");
		const approval = studio.page.locator(".inline-approval");
		await approval.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		assert.match(await approval.textContent() ?? "", /heartbeat-permission-restore/);
		await approval.locator(".dialog-btn-danger").click();
		await studio.page.getByText(permissionReply).first().waitFor({ state: "visible", timeout: REPLY_TIMEOUT_MS });
	} catch (error) {
		await studio.dumpDiagnostics();
		throw error;
	}
});
