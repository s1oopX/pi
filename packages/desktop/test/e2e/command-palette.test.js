import assert from "node:assert/strict";
import test from "node:test";
import { launchStudio } from "./harness.mjs";

test("command palette preserves keyboard visibility and focus continuity", async (t) => {
	const studio = await launchStudio();
	t.after(() => studio.close());

	await studio.waitUntilReady();
	await studio.page.keyboard.press("Control+K");
	const input = studio.page.getByRole("combobox", { name: /commands|命令/u });
	await input.waitFor();
	for (let index = 0; index < 11; index++) await input.press("ArrowDown");

	const visibility = await studio.page.evaluate(() => {
		const activeId = document.querySelector('.command-palette [role="combobox"]')?.getAttribute("aria-activedescendant");
		const active = activeId ? document.getElementById(activeId) : null;
		const results = document.querySelector(".command-palette-results");
		if (!(active instanceof HTMLElement) || !(results instanceof HTMLElement)) return null;
		const activeRect = active.getBoundingClientRect();
		const resultsRect = results.getBoundingClientRect();
		return {
			activeBottom: activeRect.bottom,
			resultsBottom: resultsRect.bottom,
			scrollTop: results.scrollTop,
		};
	});
	assert.ok(visibility);
	assert.ok(visibility.activeBottom <= visibility.resultsBottom, JSON.stringify(visibility));
	assert.ok(visibility.scrollTop > 0, JSON.stringify(visibility));

	await input.press("Escape");
	const composer = studio.page.locator(".composer-input");
	await composer.focus();
	await studio.page.keyboard.press("Control+K");
	await input.waitFor();
	await input.press("Home");
	await input.press("Enter");
	await studio.page.locator(".settings-panel").waitFor();
	await studio.page.keyboard.press("Escape");
	await studio.page.locator(".settings-panel").waitFor({ state: "hidden" });
	assert.equal(await composer.evaluate((element) => element === document.activeElement), true);
});
