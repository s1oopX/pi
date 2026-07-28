import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { assertPrerequisites, launchStudio, LAUNCH_TIMEOUT_MS, REPLY_TIMEOUT_MS } from "./harness.mjs";

const FINAL_REPLY = "Artifact ready. Source: [OpenAI docs](https://developers.openai.com/codex/).";

test("task resources: cited sources and produced files stay available in the workbench", async (t) => {
	assertPrerequisites();

	const studio = await launchStudio({
		script: [
			{
				toolCalls: [{
					id: "write_report",
					name: "write",
					arguments: { path: "report.md", content: "# Artifact\n\nInitial version.\n" },
				}],
			},
			{ reply: FINAL_REPLY },
		],
	});
	t.after(() => studio.close());

	try {
		await studio.waitUntilReady();
		await studio.sendPrompt("Create a report with a cited source");
		const approval = studio.page.locator(".inline-approval");
		await approval.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		await approval.locator(".dialog-btn-primary").click();
		await studio.page.getByText("Artifact ready. Source:").first().waitFor({ state: "visible", timeout: REPLY_TIMEOUT_MS });

		await studio.page.locator(".top-bar-workbench-toggle").click();
		await studio.page.locator('[data-workbench-view="sources"]').click();
		const sources = studio.page.locator(".workbench-resources");
		await sources.getByText("OpenAI docs", { exact: true }).waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		assert.equal(await sources.locator(".workbench-resource-row").count(), 1);

		await studio.page.locator(".workbench-back").click();
		await studio.page.locator('[data-workbench-view="artifacts"]').click();
		await studio.page.locator(".workbench-resources").getByText("report.md", { exact: true }).click();
		const preview = studio.page.locator(".workbench-artifact-preview");
		await preview.getByRole("heading", { name: "Artifact" }).waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		await preview.getByText("text/markdown", { exact: true }).waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });

		writeFileSync(join(studio.workspaceDir, "report.md"), "# Refreshed\n\nLatest version.\n");
		await preview.locator(".workbench-artifact-toolbar > .icon-button").nth(1).click();
		await preview.getByRole("heading", { name: "Refreshed" }).waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		await preview.locator(".workbench-primary.secondary").click();
		assert.match(await preview.locator(".workbench-artifact-source").textContent(), /# Refreshed/);
	} catch (error) {
		await studio.dumpDiagnostics();
		throw error;
	}
});
