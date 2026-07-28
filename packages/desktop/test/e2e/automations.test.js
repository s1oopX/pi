import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { assertPrerequisites, launchStudio, REPLY_TIMEOUT_MS } from "./harness.mjs";

const AUTOMATION_PROMPT = "AUTOMATION_PROMPT: summarize this workspace";
const AUTOMATION_REPLY = "Automation reply from faux provider.";

test("automations: create, run now, persist, and reopen the independent session", async (t) => {
	assertPrerequisites();

	const studio = await launchStudio({ reply: AUTOMATION_REPLY });
	t.after(() => studio.close());

	try {
		await studio.waitUntilReady();
		await studio.page.locator(".sidebar-automations-button").click();
		await studio.page.locator(".automations-page").waitFor({ state: "visible" });

		await studio.page.locator(".automations-new").click();
		const form = studio.page.locator("#automation-editor-form");
		await form.locator('[name="name"]').fill("Workspace summary");
		await form.locator('[name="prompt"]').fill(AUTOMATION_PROMPT);
		await form.locator('[name="schedule"]').selectOption("daily");
		await studio.page.locator('.automation-editor-dialog button[type="submit"]').click();

		const card = studio.page.locator(".automation-card").filter({ hasText: "Workspace summary" });
		await card.waitFor({ state: "visible" });
		await card.locator(".automation-run-now").click();
		await card.locator(".automation-run-status.success").first().waitFor({ state: "visible", timeout: REPLY_TIMEOUT_MS });

		assert.ok(
			studio.server.requests.some((request) => JSON.stringify(request.body?.messages ?? []).includes(AUTOMATION_PROMPT)),
			"automation prompt did not reach the faux provider",
		);
		const stored = JSON.parse(readFileSync(join(studio.tempRoot, "user-data", "automations.json"), "utf8"));
		assert.equal(stored.automations[0].runs[0].status, "success");
		assert.ok(stored.automations[0].runs[0].sessionFile, "automation run did not retain a session file");

		await card.locator(".automation-history summary").click();
		await card.locator(".automation-open-run").click();
		await studio.page.locator(".automations-page").waitFor({ state: "detached", timeout: REPLY_TIMEOUT_MS });
		await studio.page.getByText(AUTOMATION_REPLY).first().waitFor({ state: "visible", timeout: REPLY_TIMEOUT_MS });
	} catch (error) {
		await studio.dumpDiagnostics();
		throw error;
	}
});
