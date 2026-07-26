/**
 * Shared launcher for desktop e2e tests: isolated Electron app + compiled
 * backend + faux provider. See smoke.test.js for the prerequisites.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";
import { startFauxOpenAiServer } from "./faux-openai-server.mjs";

const desktopDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const repoRoot = dirname(dirname(desktopDir));

export const LAUNCH_TIMEOUT_MS = 60000;
export const REPLY_TIMEOUT_MS = 90000;

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

function assertPrerequisite(path, buildHint) {
	assert.ok(existsSync(path), `Missing e2e prerequisite: ${path}\nBuild it with: ${buildHint}`);
}

export function assertPrerequisites() {
	assertPrerequisite(electronPath, "npm install --ignore-scripts && node node_modules/electron/install.js");
	assertPrerequisite(rendererIndex, "npm run build:renderer:offline (in packages/desktop)");
	assertPrerequisite(backendExe, "npm run build:backend (in packages/desktop)");
}

export async function launchStudio({ reply, script, setupWorkspace, extraWorkspaces = 0 } = {}) {
	const tempRoot = mkdtempSync(join(tmpdir(), "pi-studio-e2e-"));
	const workspaceDir = join(tempRoot, "workspace");
	const agentDir = join(tempRoot, "agent");
	const userDataDir = join(tempRoot, "user-data");
	const extraWorkspaceDirs = Array.from({ length: extraWorkspaces }, (_, index) =>
		join(tempRoot, `workspace-extra-${index + 1}`),
	);
	for (const dir of [workspaceDir, agentDir, userDataDir, ...extraWorkspaceDirs]) {
		mkdirSync(dir, { recursive: true });
	}
	if (setupWorkspace) {
		await setupWorkspace(workspaceDir, tempRoot);
	}

	const server = await startFauxOpenAiServer({ reply, script });
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

	const page = await app.firstWindow({ timeout: LAUNCH_TIMEOUT_MS });
	page.on("console", (message) => rendererLogs.push(`[${message.type()}] ${message.text()}`));
	await page.evaluate(() => {
		window.__e2eBackendTrace = [];
		window.piDesktop?.onLog((entry) => window.__e2eBackendTrace.push({ log: entry }));
		window.piDesktop?.onStatus((status) => window.__e2eBackendTrace.push({ ts: Date.now(), status }));
		window.piDesktop?.onEvent((event) =>
			window.__e2eBackendTrace.push({ ts: Date.now(), event: { type: event?.type, backendId: event?.backendId } }),
		);
	});

	return {
		app,
		page,
		server,
		tempRoot,
		workspaceDir,
		extraWorkspaceDirs,

		/**
		 * Replace the native folder picker with a canned choice so tests can
		 * drive flows that open dialog.showOpenDialog.
		 */
		async stubFolderPicker(pickedPath) {
			await app.evaluate(({ dialog }, picked) => {
				dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
			}, pickedPath);
		},

		async waitUntilReady() {
			// Wait for the app to fully settle (backend ready, models loaded) before
			// typing: workspace draft restoration clears the composer during startup.
			await page.waitForSelector(".backend-dot.ready", { timeout: LAUNCH_TIMEOUT_MS });
			await page.getByText("Faux 1").first().waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
		},

		async waitForWorkspaceSettled() {
			// Hydration end marker: the model slot drops its loading state once the
			// workspace (or parallel-task) switch finishes. Typing before that risks
			// the draft restoration clearing the composer mid-fill on slow runners.
			await page.waitForSelector(".composer-model-slot:not(.loading)", { timeout: LAUNCH_TIMEOUT_MS });
		},

		async sendPrompt(text) {
			const composer = page.locator(".composer-input");
			await page.waitForSelector(".composer-input:not([disabled])", { timeout: LAUNCH_TIMEOUT_MS });
			await composer.fill(text);
			await page.waitForFunction(
				(expected) => document.querySelector(".composer-input")?.value === expected,
				text,
				{ timeout: 10000 },
			);
			await page.waitForSelector(".composer-send-btn:not([disabled])", { timeout: LAUNCH_TIMEOUT_MS });
			await page.locator(".composer-send-btn").click();
		},

		async dumpDiagnostics() {
			const screenshotPath = join(
				process.env.PI_STUDIO_E2E_ARTIFACTS || tmpdir(),
				`pi-studio-e2e-failure-${Date.now()}.png`,
			);
			try {
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
		},

		async close() {
			await app.close().catch(() => {});
			await server.close();
			try {
				rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5 });
			} catch {
				// Windows can keep transient locks on the temp profile; leaving it
				// behind is harmless.
			}
		},
	};
}
