import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { assertPrerequisites, launchStudio, LAUNCH_TIMEOUT_MS } from "./harness.mjs";

test("workbench browser embeds HTTP pages with navigation controls", async (t) => {
	assertPrerequisites();

	const visits = new Map();
	const server = createServer((request, response) => {
		const path = request.url === "/two" ? "/two" : "/one";
		const count = (visits.get(path) ?? 0) + 1;
		visits.set(path, count);
		response.setHeader("Content-Type", "text/html; charset=utf-8");
		response.end(`<!doctype html><main>Embedded page ${path.slice(1)} visit ${count}</main>`);
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	t.after(() => new Promise((resolve) => server.close(resolve)));
	const serverAddress = server.address();
	assert.ok(serverAddress && typeof serverAddress !== "string");
	const baseUrl = `http://127.0.0.1:${serverAddress.port}`;

	const studio = await launchStudio();
	t.after(() => studio.close());

	try {
		await studio.waitUntilReady();
		await studio.page.locator(".top-bar-workbench-toggle").click();
		await studio.page.locator('[data-workbench-view="browser"]').click();

		const browser = studio.page.locator(".workbench-browser");
		const address = browser.getByRole("textbox", { name: "URL" });
		const frame = browser.frameLocator("iframe");

		await address.fill("file:///C:/Windows/System32");
		await address.press("Enter");
		assert.equal(await browser.locator("iframe").count(), 0, "non-HTTP URL should not create a frame");

		await address.fill(`${baseUrl}/one`);
		await address.press("Enter");
		await frame.getByText("Embedded page one visit 1", { exact: true }).waitFor({ timeout: LAUNCH_TIMEOUT_MS });

		await address.fill(`${baseUrl}/two`);
		await address.press("Enter");
		await frame.getByText("Embedded page two visit 1", { exact: true }).waitFor({ timeout: LAUNCH_TIMEOUT_MS });

		await browser.getByRole("button", { name: /Back|后退/u }).click();
		await frame.getByText("Embedded page one visit 2", { exact: true }).waitFor({ timeout: LAUNCH_TIMEOUT_MS });
		assert.equal(await address.inputValue(), `${baseUrl}/one`);

		await browser.getByRole("button", { name: /Forward|前进/u }).click();
		await frame.getByText("Embedded page two visit 2", { exact: true }).waitFor({ timeout: LAUNCH_TIMEOUT_MS });

		await browser.getByRole("button", { name: /Reload|刷新/u }).click();
		await frame.getByText("Embedded page two visit 3", { exact: true }).waitFor({ timeout: LAUNCH_TIMEOUT_MS });
		assert.equal(await browser.getByRole("button", { name: /Open externally|在外部浏览器中打开/u }).isEnabled(), true);
	} catch (error) {
		await studio.dumpDiagnostics();
		throw error;
	}
});
