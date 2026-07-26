/**
 * End-to-end smoke test: real Electron app + real RPC backend + faux provider.
 *
 * Prerequisites (built artifacts):
 * - node_modules/electron/dist (npm install --ignore-scripts && node node_modules/electron/install.js)
 * - renderer-next/dist (npm run build:renderer:offline)
 * - packages/coding-agent/dist/pi-studio-backend[.exe] (npm run build:backend)
 *
 * The app runs against fully isolated state: workspace, agent config
 * (PI_CODING_AGENT_DIR), and Electron userData (PI_STUDIO_USER_DATA_DIR) all
 * live in a temp directory, and the only model is a faux provider on
 * 127.0.0.1. See harness.mjs.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { assertPrerequisites, launchStudio, REPLY_TIMEOUT_MS } from "./harness.mjs";

const FAUX_REPLY = "Hello from faux provider.";

test("smoke: prompt round-trip through the real backend", async (t) => {
	assertPrerequisites();

	const studio = await launchStudio({ reply: FAUX_REPLY });
	t.after(() => studio.close());

	try {
		await studio.waitUntilReady();
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
	} catch (error) {
		await studio.dumpDiagnostics();
		throw error;
	}
});
