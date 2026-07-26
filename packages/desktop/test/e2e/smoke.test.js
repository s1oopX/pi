/**
 * End-to-end smoke test: real Electron app + real RPC backend + faux provider.
 *
 * Prerequisites (built artifacts, see the error messages below):
 * - renderer-next/dist (npm run build:renderer:offline)
 * - packages/coding-agent/dist/pi-studio-backend[.exe] (npm run build:backend)
 *
 * The app runs against fully isolated state: workspace, agent config
 * (PI_CODING_AGENT_DIR), and Electron userData (APPDATA/LOCALAPPDATA) all live
 * in a temp directory, and the only model is a faux provider on 127.0.0.1.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";
import { startFauxOpenAiServer } from "./faux-openai-server.mjs";

const desktopDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const repoRoot = dirname(dirname(desktopDir));
const electronPath = join(
	repoRoot,
	"node_modules",
	"electron",
	"dist",
	process.platform === "win32" ? "electron.exe" : "electron",
);
const rendererIndex = join(desktopDir, "renderer-next", "dist", "index.html");
const backendExe = join(
	repoRoot,
	"packages",
	"coding-agent",
	"dist",
	process.platform === "win32" ? "pi-studio-backend.exe" : "pi-studio-backend",
);

const FAUX_REPLY = "Hello from faux provider.";
const LAUNCH_TIMEOUT_MS = 60000;
const REPLY_TIMEOUT_MS = 90000;

function assertPrerequisite(path, buildHint) {
	assert.ok(existsSync(path), `Missing e2e prerequisite: ${path}\nBuild it with: ${buildHint}`);
}

test("smoke: prompt round-trip through the real backend", async (t) => {
	assertPrerequisite(electronPath, "npm install --ignore-scripts");
	assertPrerequisite(rendererIndex, "npm run build:renderer:offline (in packages/desktop)");
	assertPrerequisite(backendExe, "npm run build:backend (in packages/desktop)");

	const tempRoot = mkdtempSync(join(tmpdir(), "pi-studio-e2e-"));
	const workspaceDir = join(tempRoot, "workspace");
	const agentDir = join(tempRoot, "agent");
	const userDataDir = join(tempRoot, "user-data");
	for (const dir of [workspaceDir, agentDir, userDataDir]) {
		mkdirSync(dir, { recursive: true });
	}

	const server = await startFauxOpenAiServer({ reply: FAUX_REPLY });
	writeFileSync(
		join(agentDir, "models.json"),
		`${JSON.stringify(
			{
				providers: {
					faux: {
						baseUrl: server.baseUrl,
						api: "openai-completions",
						apiKey: "faux-key",
						models: [{ id: "faux-1", name: "Faux 1", contextWindow: 32000, maxTokens: 4096 }],
					},
				},
			},
			null,
			2,
		)}\n`,
	);

	const mainProcessLogs = [];
	const rendererLogs = [];
	const app = await _electron.launch({
		executablePath: electronPath,
		args: [desktopDir],
		cwd: desktopDir,
		env: {
			...process.env,
			PI_DESKTOP_CWD: workspaceDir,
			PI_CODING_AGENT_DIR: agentDir,
			PI_STUDIO_USER_DATA_DIR: userDataDir,
			PI_DEV: "",
		},
		timeout: LAUNCH_TIMEOUT_MS,
	});
	app.process().stdout?.on("data", (chunk) => mainProcessLogs.push(String(chunk)));
	app.process().stderr?.on("data", (chunk) => mainProcessLogs.push(String(chunk)));

	t.after(async () => {
		await app.close().catch(() => {});
		await server.close();
		try {
			rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5 });
		} catch {
			// Windows can keep transient locks on the temp profile; leaving it
			// behind is harmless.
		}
	});

	try {
		const page = await app.firstWindow({ timeout: LAUNCH_TIMEOUT_MS });
		page.on("console", (message) => rendererLogs.push(`[${message.type()}] ${message.text()}`));
		await page.evaluate(() => {
			window.__e2eBackendTrace = [];
			window.piDesktop?.onLog((entry) => window.__e2eBackendTrace.push({ log: entry }));
			window.piDesktop?.onStatus((status) => window.__e2eBackendTrace.push({ status }));
		});

		// Wait for the app to fully settle (backend ready, models loaded) before
		// typing: workspace draft restoration clears the composer during startup.
		await page.waitForSelector(".backend-dot.ready", { timeout: LAUNCH_TIMEOUT_MS });
		await page.getByText("Faux 1").first().waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });

		const composer = page.locator(".composer-input");
		await page.waitForSelector(".composer-input:not([disabled])", { timeout: LAUNCH_TIMEOUT_MS });
		await composer.fill("Say hello");
		await page.waitForFunction(
			() => document.querySelector(".composer-input")?.value === "Say hello",
			undefined,
			{ timeout: 10000 },
		);
		await page.waitForSelector(".composer-send-btn:not([disabled])", { timeout: LAUNCH_TIMEOUT_MS });
		await page.locator(".composer-send-btn").click();

		await page.getByText(FAUX_REPLY).first().waitFor({ state: "visible", timeout: REPLY_TIMEOUT_MS });

		assert.ok(server.requests.length >= 1, "faux provider received no completion request");
		const firstRequest = server.requests[0].body;
		assert.equal(firstRequest?.model, "faux-1");
		const userMessages = (firstRequest?.messages ?? []).filter((message) => message.role === "user");
		assert.ok(
			userMessages.some((message) => JSON.stringify(message.content).includes("Say hello")),
			"prompt text did not reach the faux provider",
		);
	} catch (error) {
		const screenshotPath = join(process.env.PI_STUDIO_E2E_ARTIFACTS || tmpdir(), "pi-studio-smoke-failure.png");
		try {
			const page = await app.firstWindow({ timeout: 2000 });
			await page.screenshot({ path: screenshotPath });
			console.error(`Saved failure screenshot: ${screenshotPath}`);
			const backendStatus = await page.evaluate(() => window.piDesktop?.getBackendStatus());
			console.error("--- backend status ---");
			console.error(JSON.stringify(backendStatus, null, 2));
			const trace = await page.evaluate(() => window.__e2eBackendTrace ?? []);
			console.error("--- backend status/log trace ---");
			console.error(JSON.stringify(trace, null, 2));
		} catch {
			// no window to capture
		}
		console.error("--- main process output ---");
		console.error(mainProcessLogs.join(""));
		console.error("--- renderer console ---");
		console.error(rendererLogs.join("\n"));
		console.error(`--- faux provider requests: ${server.requests.length} ---`);
		throw error;
	}
});
