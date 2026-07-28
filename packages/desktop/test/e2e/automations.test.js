import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { assertPrerequisites, launchStudio, REPLY_TIMEOUT_MS } from "./harness.mjs";

const AUTOMATION_PROMPT = "AUTOMATION_TEMPLATE_PROMPT: summarize this workspace";
const AUTOMATION_REPLY = "Automation reply from faux provider.";

test("automations: create, run now, persist, and reopen the independent session", async (t) => {
	assertPrerequisites();

	const studio = await launchStudio({
		reply: AUTOMATION_REPLY,
		setupWorkspace: (_workspaceDir, tempRoot) => {
			const promptsDir = join(tempRoot, "agent", "prompts");
			mkdirSync(promptsDir, { recursive: true });
			writeFileSync(
				join(promptsDir, "automation-summary.md"),
				`---\ndescription: Summarize the current workspace\n---\n${AUTOMATION_PROMPT}\n`,
			);
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
		await form.locator('[name="schedule"]').selectOption("daily");
		await form.locator('[name="notificationPolicy"]').selectOption("failures");
		await studio.page.locator('.automation-editor-dialog button[type="submit"]').click();

		const card = studio.page.locator(".automation-card").filter({ hasText: "Workspace summary" });
		await card.waitFor({ state: "visible" });
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
