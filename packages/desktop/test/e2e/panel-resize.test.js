import assert from "node:assert/strict";
import test from "node:test";
import { launchStudio } from "./harness.mjs";

test("panel resize supports keyboard and pointer cancellation", async (t) => {
	const studio = await launchStudio();
	t.after(() => studio.close());

	await studio.waitUntilReady();
	const handle = studio.page.locator(".sidebar-resize");
	const initialWidth = Number(await handle.getAttribute("aria-valuenow"));
	await handle.focus();
	await handle.press("ArrowRight");
	assert.equal(Number(await handle.getAttribute("aria-valuenow")), initialWidth + 16);

	const box = await handle.boundingBox();
	assert.ok(box);
	await handle.dispatchEvent("pointerdown", { button: 0, clientX: box.x + box.width / 2, pointerId: 1 });
	await studio.page.evaluate((clientX) => {
		window.dispatchEvent(new PointerEvent("pointermove", { clientX, pointerId: 1 }));
	}, box.x + 64);
	await studio.page.locator(".app-shell.resizing").waitFor();
	await studio.page.evaluate(() => {
		window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 }));
	});
	await studio.page.locator(".app-shell.resizing").waitFor({ state: "hidden", timeout: 1000 });
	assert.equal(Number(await handle.getAttribute("aria-valuenow")), initialWidth + 16);
});
