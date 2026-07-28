import test from "node:test";
import { assertPrerequisites, launchStudio, REPLY_TIMEOUT_MS } from "./harness.mjs";

test("thread organization: pin, archive, and restore a session", async (t) => {
	assertPrerequisites();

	const studio = await launchStudio({ reply: "Thread organization ready." });
	t.after(() => studio.close());

	try {
		await studio.waitUntilReady();
		await studio.sendPrompt("Create an organized thread");
		await studio.page.getByText("Thread organization ready.").first().waitFor({
			state: "visible",
			timeout: REPLY_TIMEOUT_MS,
		});

		let row = studio.page.locator(".agent-row-shell.active");
		await row.waitFor({ state: "visible", timeout: REPLY_TIMEOUT_MS });
		await row.locator(".agent-row-menu-trigger").click();
		await studio.page.getByRole("menuitem", { name: /^(Pin|置顶)$/u }).click();
		await row.locator(".agent-row-pin").waitFor({ state: "visible" });

		await row.locator(".agent-row-menu-trigger").click();
		await studio.page.getByRole("menuitem", { name: /^(Archive|归档)$/u }).click();
		await row.waitFor({ state: "detached" });

		await studio.page.locator(".thread-view-tabs button").nth(1).click();
		row = studio.page.locator(".agent-row-shell.active");
		await row.waitFor({ state: "visible" });
		await row.locator(".agent-row-menu-trigger").click();
		await studio.page.getByRole("menuitem", { name: /^(Restore|恢复)$/u }).click();
		await row.waitFor({ state: "detached" });

		await studio.page.locator(".thread-view-tabs button").first().click();
		await studio.page.locator(".agent-row-shell.active").waitFor({ state: "visible" });
	} catch (error) {
		await studio.dumpDiagnostics();
		throw error;
	}
});
