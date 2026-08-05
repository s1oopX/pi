/**
 * End-to-end smoke test: real Electron app + real RPC backend + faux provider.
 *
 * Prerequisites (source mode):
 * - node_modules/electron/dist (npm install --ignore-scripts && node node_modules/electron/install.js)
 * - renderer-next/dist (npm run build:renderer:offline)
 * - packages/coding-agent/dist/pi-studio-backend[.exe] (npm run build:backend)
 *
 * Set PI_STUDIO_E2E_EXECUTABLE to test a packaged app instead.
 *
 * The app runs against fully isolated state: workspace, agent config
 * (PI_CODING_AGENT_DIR), and Electron userData (PI_STUDIO_USER_DATA_DIR) all
 * live in a temp directory, and the only model is a faux provider on
 * 127.0.0.1. See harness.mjs.
 */

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { assertPrerequisites, launchStudio, LAUNCH_TIMEOUT_MS, REPLY_TIMEOUT_MS } from "./harness.mjs";

const FAUX_REPLY = "Hello from faux provider.";
const RETRY_REPLY = "Recovered after retry.";
const FILE_REPLY = "File reference received.";
const ATTACHMENT_REPLY = "Attachment received.";
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function dispatchImageTransfer(page, selector, eventName, name) {
	await page.locator(selector).evaluate((element, { base64, fileName, type }) => {
		const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
		const transfer = new DataTransfer();
		transfer.items.add(new File([bytes], fileName, { type: "image/png" }));
		const event = type === "paste"
			? new ClipboardEvent(type, { bubbles: true, cancelable: true, clipboardData: transfer })
			: new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer });
		element.dispatchEvent(event);
	}, { base64: PNG_BASE64, fileName: name, type: eventName });
}

test("smoke: prompt round-trip through the real backend", async (t) => {
	assertPrerequisites();

	const studio = await launchStudio({
			script: [
			{ reply: FAUX_REPLY },
			{ reply: "This reply should be stopped.", delayMs: 20000 },
			{ status: 401, error: "Invalid API key for retry test" },
			{ reply: RETRY_REPLY },
			{ reply: FILE_REPLY },
			{ reply: ATTACHMENT_REPLY },
		],
		modelInput: ["text", "image"],
		setupWorkspace(workspaceDir) {
			mkdirSync(join(workspaceDir, "src"));
			writeFileSync(join(workspaceDir, "src", "application.ts"), "export const ready = true;\n");
		},
	});
	t.after(() => studio.close());

	try {
		await studio.waitUntilReady();

		const composer = studio.page.locator(".composer-input");
		await composer.fill("Review @src/app after this");
		for (let index = 0; index < " after this".length; index++) {
			await composer.press("ArrowLeft");
		}
		await studio.page.getByRole("option", { name: "src/application.ts" }).waitFor({
			state: "visible",
			timeout: LAUNCH_TIMEOUT_MS,
		});
		await composer.press("Tab");
		assert.equal(await composer.inputValue(), "Review @src/application.ts after this");

		await studio.sendPrompt("Say hello");

		await studio.page.getByText(FAUX_REPLY).first().waitFor({ state: "visible", timeout: REPLY_TIMEOUT_MS });

		assert.ok(studio.server.requests.length >= 1, "faux provider received no completion request");
		const firstRequest = studio.server.requests[0].body;
		assert.equal(firstRequest?.model, "faux-1");
		const userMessages = (firstRequest?.messages ?? []).filter((message) => message.role === "user");
		assert.ok(
			userMessages.some((message) => JSON.stringify(message.content).includes("Say hello")),
			"prompt text did not reach the faux provider",
		);

		// Stopping restores queued input instead of silently discarding it. Keep
		// an unsent draft too, matching the TUI's queued-message recovery order.
		await studio.sendPrompt("Start a slow run");
		await studio.page.locator(".composer-abort-btn").waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		await studio.sendPrompt("Keep this follow-up");
		await studio.page.getByText("Keep this follow-up", { exact: true }).waitFor({
			state: "visible",
			timeout: LAUNCH_TIMEOUT_MS,
		});
		await studio.page.waitForFunction(
			() => document.querySelector(".composer-input")?.value === "",
			null,
			{ timeout: LAUNCH_TIMEOUT_MS },
		);
		await composer.fill("Current draft");
		await studio.page.locator(".conversation-queue-edit").click();
		await studio.page.waitForFunction(
			(expected) => document.querySelector(".composer-input")?.value === expected,
			"Keep this follow-up\n\nCurrent draft",
			{ timeout: LAUNCH_TIMEOUT_MS },
		);
		await studio.page.locator(".composer-abort-btn").waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });

		await studio.page.locator(".composer-send-btn").click();
		await studio.page.waitForFunction(
			() => document.querySelector(".composer-input")?.value === "",
			null,
			{ timeout: LAUNCH_TIMEOUT_MS },
		);
		await composer.fill("Draft after editing queue");
		await studio.page.locator(".composer-abort-btn").click();
		await studio.page.waitForFunction(
			(expected) => document.querySelector(".composer-input")?.value === expected,
			"Keep this follow-up\n\nCurrent draft\n\nDraft after editing queue",
			{ timeout: LAUNCH_TIMEOUT_MS },
		);
		assert.equal(await studio.page.locator(".conversation-queue-item").count(), 0);

		await composer.fill("");
		await studio.sendPrompt("Trigger retry test");
		await studio.page.locator(".message-error").getByText("Invalid API key for retry test", { exact: false }).waitFor({
			state: "visible",
			timeout: REPLY_TIMEOUT_MS,
		});
		await studio.page
			.locator(".message-error")
			.filter({ hasText: "Invalid API key for retry test" })
			.locator(".message-error-retry")
			.click();
		await studio.page.getByText(RETRY_REPLY, { exact: true }).waitFor({
			state: "visible",
			timeout: REPLY_TIMEOUT_MS,
		});
		const retryRequests = studio.server.requests.slice(-2).map((request) => JSON.stringify(request.body?.messages ?? []));
		assert.ok(retryRequests.every((request) => request.includes("Trigger retry test")));

		await studio.page.locator(".composer-file-input").setInputFiles(join(studio.workspaceDir, "src", "application.ts"));
		await studio.page.locator(".composer-attachment-file").getByText("application.ts", { exact: true }).waitFor();
		await studio.sendPrompt("Review the attached file");
		await studio.page.getByText(FILE_REPLY, { exact: true }).waitFor({
			state: "visible",
			timeout: REPLY_TIMEOUT_MS,
		});
		const fileRequest = JSON.stringify(studio.server.requests.at(-1)?.body?.messages ?? []);
		assert.match(fileRequest, /Review the attached file/u);
		assert.match(fileRequest, /application\.ts/u);
		assert.equal(await studio.page.locator(".composer-attachment").count(), 0);

		await dispatchImageTransfer(studio.page, ".composer-input", "paste", "pasted.png");
		await studio.page.locator('.composer-attachment img[alt="pasted.png"]').waitFor({ state: "visible" });
		await dispatchImageTransfer(studio.page, "form.composer", "dragenter", "dropped.png");
		await dispatchImageTransfer(studio.page, "form.composer", "drop", "dropped.png");
		await studio.page.locator('.composer-attachment img[alt="dropped.png"]').waitFor({ state: "visible" });
		await studio.sendPrompt("Compare both images");
		await studio.page.getByText(ATTACHMENT_REPLY, { exact: true }).waitFor({
			state: "visible",
			timeout: REPLY_TIMEOUT_MS,
		});
		const attachmentContent = studio.server.requests.at(-1)?.body?.messages?.at(-1)?.content;
		assert.ok(Array.isArray(attachmentContent), "provider did not receive multimodal user content");
		assert.equal(attachmentContent.filter((part) => part.type === "image_url").length, 2);
		assert.equal(await studio.page.locator(".composer-attachment").count(), 0);

		// Keep the latest response visible when the window and text scale reflow
		// an otherwise settled conversation.
		await studio.app.evaluate(({ BrowserWindow }) => {
			BrowserWindow.getAllWindows()[0]?.setSize(720, 520);
		});
		await studio.page.evaluate(() => {
			document.documentElement.style.setProperty("--root-font-size", "19.2px");
			document.documentElement.style.setProperty("--font-scale", "1.2");
		});
		await studio.page.waitForFunction(() => {
			const list = document.querySelector(".message-list-scroll");
			return list instanceof HTMLElement && list.scrollHeight - list.clientHeight - list.scrollTop <= 2;
		}, null, { timeout: LAUNCH_TIMEOUT_MS });
		const narrowLayout = await studio.page.evaluate(() => ({
			documentWidth: document.documentElement.scrollWidth,
			viewportWidth: document.documentElement.clientWidth,
			composer: document.querySelector(".composer")?.getBoundingClientRect().toJSON(),
		}));
		assert.equal(narrowLayout.documentWidth, narrowLayout.viewportWidth);
		assert.ok(narrowLayout.composer && narrowLayout.composer.right <= narrowLayout.viewportWidth);

		// The rolling file log recorded the boot and the backend becoming ready.
		const logContent = readFileSync(join(studio.tempRoot, "user-data", "logs", "pi-studio.log"), "utf8");
		assert.match(logContent, /Pi Studio .* starting/u);
		assert.match(logContent, /backend:main status ready/u);
	} catch (error) {
		await studio.dumpDiagnostics();
		throw error;
	}
});
