import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, Notification, screen, shell } from "electron";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	BACKEND_REQUEST_COMMAND_TYPES,
	BACKEND_SEND_COMMAND_TYPES,
	describeBackendCommandRejection,
} from "./backend-command-allowlist.js";
import { BackendHandle } from "./backend-handle.js";
import { createAutomationService } from "./automations.js";
import { sanitizeDiagnostics } from "./diagnostics.js";
import {
	applyGitHunk,
	commitAllChanges,
	getFileDiff,
	listGitBranches,
	listGitChanges,
	pushCurrentBranch,
	restoreFileChanges,
	switchGitBranch,
} from "./git-commit.js";
import {
	createPullRequest,
	getPullRequestContext,
	getPullRequestReview,
	updatePullRequestReview,
} from "./git-pr.js";
import { getGitWorkspaceStatus } from "./git-workspace-status.js";
import {
	createTaskWorktree,
	deleteLeftoverWorktree,
	isGitRepository,
	isPathInsideWorktreesRoot,
	listWorktreeLeftovers,
	removeTaskWorktree,
} from "./git-worktree.js";
import { applySource, MIRROR_MANAGERS, MIRROR_PRESETS, readStatus } from "./mirror-sources.js";
import { describeRevealTarget, resolveWorkspacePath } from "./path-reveal.js";
import { createProject } from "./project-templates.js";
import { createRollingLog } from "./rolling-log.js";
import { prepareSessionImport, resolveKnownSessionFile } from "./session-files.js";
import { materializeSshArtifact, readSshArtifactPreview } from "./ssh-artifact.js";
import { createTaskRegistry } from "./task-registry.js";
import {
	createSshCliSpec,
	createSshLaunchSpec,
	createSshPiInstallSpec,
	createSshTestSpec,
	createSshTrashSpec,
	createSshWorktreeDeleteSpec,
	createSshWorktreeListSpec,
	createSshWorktreeRemoveSpec,
	createSshWorktreeSpec,
	createSshWorkspaceUri,
	loadSshConnections,
	normalizeSshConnection,
	parseSshWorktreeList,
	resolveSshWorkspace,
	saveSshConnections,
	upsertSshConnection,
} from "./ssh-remote.js";
import { checkDesktopUpdate } from "./update.js";
import { readWorkspaceFilePreview, resolveWorkspaceFilePath } from "./workspace-file-preview.js";
import { loadStoredWorkspace, saveStoredWorkspace } from "./workspace-state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRODUCT_NAME = "Pi Studio";

// Relocates all profile state (window/workspace state, renderer localStorage,
// the single-instance lock) so e2e runs never touch the real profile. Must run
// before anything derives a path from userData.
if (process.env.PI_STUDIO_USER_DATA_DIR) {
	app.setPath("userData", process.env.PI_STUDIO_USER_DATA_DIR);
}
const WINDOW_STATE_FILE = "window-state.json";
const WORKSPACE_STATE_FILE = "workspace-state.json";
const TASK_WORKSPACE_DIRECTORY = "tasks";
const TASK_SETTINGS_FILE = "task-settings.json";
const AUTOMATIONS_FILE = "automations.json";
const SSH_CONNECTIONS_FILE = "ssh-connections.json";
const REMOTE_ARTIFACT_CACHE_DIRECTORY = "remote-artifacts";
const MAX_IDLE_MINUTES = 240;
const DEFAULT_TASK_SETTINGS = { maxTasks: 3, idleMinutes: 30 };
const AUTOMATION_START_TIMEOUT_MS = 30_000;
const AUTOMATION_RUN_TIMEOUT_MS = 30 * 60 * 1000;

/** @type {import("electron").BrowserWindow | undefined} */
let mainWindow;
/** @type {Promise<void> | undefined} */
let windowCreationPromise;
let backendCwd = process.env.PI_DESKTOP_CWD || process.cwd();
let isQuitting = false;
let workspaceStateInitialized = false;
/** @type {Buffer | undefined} */
let remoteBridgeSource;
/** @type {ReturnType<typeof createAutomationService> | undefined} */
let automationService;
/** @type {Set<BackendHandle>} */
const automationHandles = new Set();
/** @type {Set<BackendHandle>} */
const automationBusyHandles = new Set();
/** @type {Set<string>} */
const automationSessionLocks = new Set();

// Every backend child and its per-process state lives in a BackendHandle
// (src/backend-handle.js); the task registry owns the pool of them
// (src/task-registry.js). The primary follows the workspace; pool members are
// pinned to the folder they were created for.
const primaryBackend = new BackendHandle({
	id: "main",
	getCwd: () => backendCwd,
	getBackendPath: getPrimaryBackendPath,
	getLaunchSpec: getPrimaryLaunchSpec,
	sendToRenderer,
	onSessionChanged: syncBackendCwd,
	notify: maybeNotify,
	isQuitting: () => isQuitting,
});
const taskRegistry = createTaskRegistry({
	primary: primaryBackend,
	createHandle: (id, cwd) =>
		new BackendHandle({
			id,
			getCwd: () => cwd,
			getBackendPath: () => getBackendDisplayPath(cwd),
			getLaunchSpec: () => getBackendLaunchSpec(cwd),
			sendToRenderer,
			// No onSessionChanged: a pool task's session must never rewrite the
			// primary workspace or its persisted state.
			notify: (payload) => maybeNotify(payload, id),
			isQuitting: () => isQuitting,
		}),
});

function getWindowStatePath() {
	return join(app.getPath("userData"), WINDOW_STATE_FILE);
}

function getWorkspaceStatePath() {
	return join(app.getPath("userData"), WORKSPACE_STATE_FILE);
}

function getTaskWorkspacePath() {
	const taskWorkspacePath = join(app.getPath("userData"), TASK_WORKSPACE_DIRECTORY);
	mkdirSync(taskWorkspacePath, { recursive: true });
	return taskWorkspacePath;
}

function getAutomationsPath() {
	return join(app.getPath("userData"), AUTOMATIONS_FILE);
}

function getSshConnectionsPath() {
	return join(app.getPath("userData"), SSH_CONNECTIONS_FILE);
}

function getRemoteArtifactCachePath() {
	return join(app.getPath("userData"), REMOTE_ARTIFACT_CACHE_DIRECTORY);
}

function getRemoteBridgeSource() {
	remoteBridgeSource ??= readFileSync(join(__dirname, "..", "assets", "remote-bridge.js"));
	return remoteBridgeSource;
}

/** @param {string} cwd */
function resolveSshCwd(cwd) {
	if (!cwd.startsWith("ssh://")) return null;
	return resolveSshWorkspace(cwd, loadSshConnections(getSshConnectionsPath()));
}

function getActiveSshWorkspace() {
	return resolveSshCwd(backendCwd);
}

/** @param {string} cwd */
function getBackendDisplayPath(cwd) {
	try {
		const remote = resolveSshCwd(cwd);
		return remote ? `ssh:${remote.connection.name}` : getBackendPath();
	} catch {
		return "ssh";
	}
}

/** @param {string} cwd */
function getBackendLaunchSpec(cwd) {
	const remote = resolveSshCwd(cwd);
	return remote
		? createSshLaunchSpec(remote.connection, remote.remotePath, getRemoteBridgeSource())
		: undefined;
}

function getPrimaryBackendPath() {
	return getBackendDisplayPath(backendCwd);
}

function getPrimaryLaunchSpec() {
	return getBackendLaunchSpec(backendCwd);
}

/** @param {string} path */
function sessionPathKey(path) {
	const normalized = resolve(String(path ?? ""));
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/** @param {unknown} path */
function isAutomationSessionLocked(path) {
	return typeof path === "string" && path.length > 0 && automationSessionLocks.has(sessionPathKey(path));
}

function initializeBackendCwd() {
	if (workspaceStateInitialized) return;
	workspaceStateInitialized = true;
	if (process.env.PI_DESKTOP_CWD) return;
	try {
		const autoConnection = loadSshConnections(getSshConnectionsPath()).find(({ autoConnect }) => autoConnect);
		if (autoConnection) {
			backendCwd = createSshWorkspaceUri(autoConnection.id, autoConnection.remotePath);
			return;
		}
	} catch (error) {
		sendToRenderer("backend:log", {
			level: "warn",
			message: `Could not load SSH connections: ${error instanceof Error ? error.message : String(error)}`,
		});
	}
	backendCwd = loadStoredWorkspace(getWorkspaceStatePath()) ?? backendCwd;
}

function persistBackendCwd() {
	try {
		saveStoredWorkspace(getWorkspaceStatePath(), backendCwd);
	} catch (error) {
		sendToRenderer("backend:log", {
			level: "warn",
			message: `Could not save workspace state: ${error instanceof Error ? error.message : String(error)}`,
		});
	}
}

/** @param {string} cwd */
function syncBackendCwd(cwd) {
	if (typeof cwd !== "string" || !cwd.trim()) return;
	let nextCwd = cwd;
	try {
		const remote = getActiveSshWorkspace();
		if (remote) nextCwd = createSshWorkspaceUri(remote.connection.id, cwd);
	} catch (error) {
		sendToRenderer("backend:log", {
			level: "warn",
			message: `Could not map the remote workspace: ${error instanceof Error ? error.message : String(error)}`,
		});
		return;
	}
	if (backendCwd === nextCwd) return;
	backendCwd = nextCwd;
	persistBackendCwd();
	sendToRenderer("backend:status", primaryBackend.statusSnapshot());
}

function loadWindowState() {
	try {
		const state = JSON.parse(readFileSync(getWindowStatePath(), "utf8"));
		if (!state || typeof state !== "object") return undefined;
		const width = Math.round(Number(state.width));
		const height = Math.round(Number(state.height));
		const x = Math.round(Number(state.x));
		const y = Math.round(Number(state.y));
		if (![width, height, x, y].every(Number.isFinite) || width < 720 || height < 520) return undefined;
		const bounds = screen.getDisplayMatching({ x, y, width, height }).workArea;
		const fittedWidth = Math.min(width, bounds.width);
		const fittedHeight = Math.min(height, bounds.height);
		return {
			x: Math.min(Math.max(x, bounds.x), bounds.x + bounds.width - fittedWidth),
			y: Math.min(Math.max(y, bounds.y), bounds.y + bounds.height - fittedHeight),
			width: fittedWidth,
			height: fittedHeight,
			maximized: Boolean(state.maximized),
		};
	} catch {
		return undefined;
	}
}

/** @param {import("electron").BrowserWindow | undefined} window */
function saveWindowState(window) {
	if (!window || window.isDestroyed()) return;
	try {
		const bounds = window.getNormalBounds();
		mkdirSync(app.getPath("userData"), { recursive: true });
		writeFileSync(
			getWindowStatePath(),
			`${JSON.stringify({ ...bounds, maximized: window.isMaximized() }, null, 2)}\n`,
			{ encoding: "utf8", mode: 0o600 },
		);
	} catch (error) {
		sendToRenderer("backend:log", {
			level: "warn",
			message: `Could not save window state: ${error instanceof Error ? error.message : String(error)}`,
		});
	}
}

const skippedWorkspaceNames = new Set([
	".git",
	".hg",
	".svn",
	".next",
	".turbo",
	".vite",
	"dist",
	"build",
	"coverage",
	"node_modules",
	"release",
]);

function getBackendPath() {
	const backendDir = app.isPackaged
		? join(process.resourcesPath, "pi-backend")
		: join(__dirname, "..", "..", "coding-agent", "dist");
	const preferredNames =
		process.platform === "win32"
			? ["pi-studio-backend.exe"]
			: ["pi-studio-backend", "pi-studio-backend.exe"];
	for (const exeName of preferredNames) {
		const candidate = join(backendDir, exeName);
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return join(backendDir, preferredNames[0]);
}

function getRendererPath() {
	return join(__dirname, "..", "renderer-next", "dist", "index.html");
}

function getWindowIconPath() {
	const candidates = [
		join(__dirname, "..", "assets", process.platform === "win32" ? "window-icon.ico" : "window-icon.png"),
		join(__dirname, "..", "assets", "window-icon.png"),
	];
	return candidates.find((candidate) => existsSync(candidate));
}

/**
 * @param {string} root
 * @param {string} [query]
 */
function listWorkspaceFiles(root, query = "") {
	if (!root || !existsSync(root)) {
		return [];
	}
	const normalizedQuery = query.trim().toLowerCase();
	/** @type {string[]} */
	const files = [];
	const maxFiles = 180;
	const maxDepth = 4;

	const walk = (/** @type {string} */ directory, /** @type {number} */ depth) => {
		if (files.length >= maxFiles || depth > maxDepth) {
			return;
		}
		let entries;
		try {
			entries = readdirSync(directory, { withFileTypes: true });
		} catch {
			return;
		}

		entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
		for (const entry of entries) {
			if (files.length >= maxFiles || entry.isSymbolicLink() || skippedWorkspaceNames.has(entry.name)) {
				continue;
			}
			const fullPath = join(directory, entry.name);
			if (entry.isDirectory()) {
				walk(fullPath, depth + 1);
				continue;
			}
			if (!entry.isFile()) {
				continue;
			}
			const relPath = relative(root, fullPath).replaceAll("\\", "/");
			if (!normalizedQuery || relPath.toLowerCase().includes(normalizedQuery)) {
				files.push(relPath);
			}
		}
	};

	walk(root, 0);
	return files;
}

// Rolling file log (<userData>/logs): backend output, status transitions, and
// main-process faults survive crashes that the in-memory renderer log cannot.
/** @type {ReturnType<typeof createRollingLog> | undefined} */
let fileLog;
function getFileLog() {
	if (!fileLog) {
		fileLog = createRollingLog({ directory: join(app.getPath("userData"), "logs") });
		fileLog.append(
			"info",
			"main",
			`Pi Studio ${app.getVersion()} starting (electron ${process.versions.electron}, ${process.platform})`,
		);
	}
	return fileLog;
}

/**
 * @param {string} channel
 * @param {Record<string, any> | undefined} payload
 */
function mirrorToFileLog(channel, payload) {
	if (channel === "backend:log") {
		getFileLog().append(
			String(payload?.level ?? "info"),
			`backend:${payload?.backendId ?? "main"}`,
			String(payload?.message ?? ""),
		);
		return;
	}
	if (channel === "backend:status") {
		const state = payload?.error
			? `error: ${payload.error}`
			: payload?.ready
				? "ready"
				: payload?.restarting
					? `restarting in ${payload?.retryInMs ?? 0}ms`
					: payload?.starting
						? "starting"
						: "stopped";
		getFileLog().append(
			payload?.error ? "error" : "info",
			`backend:${payload?.backendId ?? "main"}`,
			`status ${state}${payload?.cwd ? ` (cwd: ${payload.cwd})` : ""}`,
		);
		return;
	}
	if (channel === "task:changed") {
		getFileLog().append("info", "tasks", `task ${payload?.taskId ?? "?"} stopped (${payload?.reason ?? "unknown"})`);
	}
}

/**
 * @param {string} channel
 * @param {object} payload
 */
function sendToRenderer(channel, payload) {
	// File first: early backend failures matter most when no window exists yet.
	mirrorToFileLog(channel, /** @type {Record<string, any>} */ (payload));
	if (!mainWindow || mainWindow.isDestroyed()) {
		return;
	}
	mainWindow.webContents.send(channel, payload);
}

// Monitor-only: observes crashes without altering Electron's fault handling.
process.on("uncaughtExceptionMonitor", (error) => {
	getFileLog().append("error", "main", `uncaught exception: ${error?.stack ?? String(error)}`);
});

/**
 * Electron's dialog API tolerates a missing parent at runtime (the dialog
 * just opens unowned), but its types require a window. Funnel the cast
 * through one place instead of sprinkling it at every call site.
 * @returns {import("electron").BrowserWindow}
 */
function dialogParent() {
	return /** @type {import("electron").BrowserWindow} */ (mainWindow);
}

/** @param {unknown} url */
async function openExternalSafely(url) {
	const target = new URL(String(url));
	if (!new Set(["https:", "http:", "mailto:"]).has(target.protocol)) {
		throw new Error(`Unsupported external URL protocol: ${target.protocol}`);
	}
	await shell.openExternal(target.toString());
}

// Fetch the model catalog from an OpenAI/Anthropic-compatible endpoint. Runs in
// the main process so the API key never touches the renderer origin and CORS
// does not apply. Sends both auth header styles since compatible gateways vary.
/** @param {{ baseUrl?: unknown, apiKey?: unknown, api?: unknown }} params */
async function fetchProviderModels({ baseUrl, apiKey, api }) {
	const trimmedBase = String(baseUrl ?? "").trim().replace(/\/+$/, "");
	if (!trimmedBase) {
		throw new Error("Base URL is required");
	}
	const base = new URL(trimmedBase);
	if (!["http:", "https:"].includes(base.protocol)) {
		throw new Error("Base URL must use HTTP or HTTPS");
	}
	const key = String(apiKey ?? "").trim();
	/** @type {Record<string, string>} */
	const headers = { Accept: "application/json" };
	if (key) {
		if (api === "anthropic-messages") {
			headers["x-api-key"] = key;
			headers["anthropic-version"] = "2023-06-01";
		} else {
			headers.Authorization = `Bearer ${key}`;
		}
	}

	// Endpoints differ on whether the base already includes /v1. The Anthropic
	// SDK expects a base WITHOUT /v1 (it appends /v1/messages), while OpenAI
	// bases usually include /v1. Try both /models and /v1/models so the user
	// does not have to know which form this endpoint wants.
	const stripped = trimmedBase.replace(/\/v1$/, "");
	const candidates = [...new Set([`${trimmedBase}/models`, `${stripped}/v1/models`])];

	let lastError = "";
	for (const modelsUrl of candidates) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 20000);
		let response;
		try {
			response = await fetch(modelsUrl, { method: "GET", headers, signal: controller.signal });
		} catch (error) {
			clearTimeout(timeout);
			lastError = `Could not reach ${modelsUrl}: ${error instanceof Error ? error.message : String(error)}`;
			continue;
		}
		clearTimeout(timeout);

		if (!response.ok) {
			let detail = "";
			try {
				detail = (await response.text()).slice(0, 300);
			} catch {
				// ignore body read failures
			}
			lastError = `HTTP ${response.status} from ${modelsUrl}${detail ? `: ${detail}` : ""}`;
			continue;
		}

		let body;
		try {
			body = await response.json();
		} catch {
			lastError = `${modelsUrl} did not return valid JSON`;
			continue;
		}

		// Accept OpenAI/Anthropic shape ({data:[...]}) or a bare array.
		const rawList = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : undefined;
		if (!rawList) {
			lastError = `Unexpected response shape from ${modelsUrl} (no data array)`;
			continue;
		}
		const models = rawList
			.map((/** @type {any} */ entry) => {
				if (typeof entry === "string") return { id: entry };
				if (entry && typeof entry === "object" && typeof entry.id === "string") {
					return {
						id: entry.id,
						name: typeof entry.display_name === "string" ? entry.display_name : undefined,
					};
				}
				return undefined;
			})
			.filter((/** @type {{ id?: unknown } | undefined} */ m) => m && m.id)
			.slice(0, 500);

		return { models };
	}

	throw new Error(lastError || "Could not fetch models from endpoint");
}

// Surface a desktop notification when a run finishes while the window is not
// focused, so the user can look away during long agent runs. Focused-window
// completions are the renderer's job (toast); pool tasks name themselves.
/**
 * @param {{ type?: string, willRetry?: boolean } | undefined} payload
 * @param {string} [taskLabel]
 */
function maybeNotify(payload, taskLabel) {
	if (payload?.type !== "agent_end" || payload.willRetry) {
		return;
	}
	if (!Notification.isSupported()) {
		return;
	}
	if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) {
		return;
	}
	try {
		const notification = new Notification({
			title: PRODUCT_NAME,
			body: taskLabel ? `Task ${taskLabel} finished responding.` : "The agent finished responding.",
			icon: getWindowIconPath(),
			silent: false,
		});
		notification.on("click", () => {
			focusMainWindow();
		});
		notification.show();
	} catch {
		// Notifications are best-effort; ignore platform failures.
	}
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @param {string} message
 * @returns {Promise<T>}
 */
function waitWithTimeout(promise, timeoutMs, message) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

/** @param {ReturnType<typeof normalizeSshConnection>} connection */
function testSshConnection(connection) {
	const spec = createSshTestSpec(connection);
	return new Promise((resolve, reject) => {
		const child = spawn(spec.command, spec.args, {
			cwd: spec.cwd,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let settled = false;
		let output = "";
		/** @type {NodeJS.Timeout | undefined} */
		let timer;
		/** @param {Error | undefined} error */
		const finish = (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error) reject(error);
			else resolve({ ok: true, message: output.trim() || "SSH connection succeeded" });
		};
		/** @param {Buffer} chunk */
		const append = (chunk) => {
			output = `${output}${chunk.toString("utf8")}`.slice(-32 * 1024);
		};
		child.stdout.on("data", append);
		child.stderr.on("data", append);
		child.on("error", (error) => finish(error));
		child.on("close", (code, signal) => {
			finish(code === 0
				? undefined
				: new Error(output.trim() || `SSH probe exited code=${code} signal=${signal}`));
		});
		timer = setTimeout(() => {
			child.kill();
			finish(new Error("SSH connection test timed out after 15 seconds"));
		}, 15_000);
	});
}

/**
 * @param {{ command: string, args: string[], cwd: string }} spec
 * @param {string} label
 * @param {number} [timeoutMs]
 * @returns {Promise<string>}
 */
function runSshSpec(spec, label, timeoutMs = 30_000) {
	return new Promise((resolvePromise, reject) => {
		execFile(
			spec.command,
			spec.args,
			{
				cwd: spec.cwd,
				encoding: "utf8",
				maxBuffer: 1024 * 1024,
				shell: false,
				timeout: timeoutMs,
				windowsHide: true,
			},
			(error, stdout, stderr) => {
				if (!error) {
					resolvePromise(stdout);
					return;
				}
				const detail = (stderr.trim() || stdout.trim() || error.message).slice(0, 500);
				reject(new Error(`${label}: ${detail}`));
			},
		);
	});
}

/**
 * @param {NonNullable<ReturnType<typeof resolveSshCwd>>} remote
 * @param {string[]} activeCwds
 */
async function listRemoteWorktreeLeftovers(remote, activeCwds) {
	const output = await runSshSpec(
		createSshWorktreeListSpec(remote.connection),
		"Could not list remote task worktrees",
	);
	const active = new Set(activeCwds);
	return parseSshWorktreeList(output)
		.map((entry) => ({
			path: createSshWorkspaceUri(remote.connection.id, entry.worktreePath),
			sourceRepo: null,
			dirty: entry.dirty,
			remote: true,
			connectionName: remote.connection.name,
			branch: entry.branch,
		}))
		.filter((entry) => !active.has(entry.path));
}

/** @param {NonNullable<ReturnType<typeof resolveSshCwd>>} remote */
async function createRemoteTaskWorktree(remote) {
	const repository = await isGitRepository(remote.remotePath, {
		execFileImpl: createRemoteCliExecFile(remote),
		timeoutMs: 30_000,
	});
	if (!repository) {
		throw new Error("That remote folder is already running. Parallel tasks need a Git repository for worktree isolation.");
	}
	const name = `remote-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
	const spec = createSshWorktreeSpec(remote.connection, remote.remotePath, name);
	await runSshSpec(spec, "Could not create the remote task worktree");
	return { branch: spec.branch, worktreePath: spec.worktreePath };
}

/** @param {string} sourceRepo @param {string} worktreePath */
async function removeRegisteredTaskWorktree(sourceRepo, worktreePath) {
	let sourceRemote;
	let worktreeRemote;
	try {
		sourceRemote = resolveSshCwd(sourceRepo);
		worktreeRemote = resolveSshCwd(worktreePath);
	} catch (error) {
		return { removed: false, reason: error instanceof Error ? error.message : String(error) };
	}
	if (!sourceRemote && !worktreeRemote) return removeTaskWorktree(sourceRepo, worktreePath);
	if (!sourceRemote || !worktreeRemote || sourceRemote.connection.id !== worktreeRemote.connection.id) {
		return { removed: false, reason: "Remote worktree metadata does not match its source connection" };
	}
	try {
		const spec = createSshWorktreeRemoveSpec(
			sourceRemote.connection,
			sourceRemote.remotePath,
			worktreeRemote.remotePath,
		);
		await runSshSpec(spec, "Could not remove the remote task worktree");
		return { removed: true };
	} catch (error) {
		return { removed: false, reason: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * @param {BackendHandle} handle
 * @param {Record<string, unknown>} command
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<unknown>}
 */
async function requestAutomationBackend(handle, command, options = {}) {
	const response = /** @type {{ success?: boolean, error?: string, command?: string, data?: unknown }} */ (
		await handle.request(command, options)
	);
	if (!response.success) throw new Error(response.error || `Command failed: ${response.command ?? command.type}`);
	return response.data;
}

/** @param {string} id @param {string} cwd */
function createAutomationHandle(id, cwd) {
	/** @type {(value?: void) => void} */
	let resolveReady = () => {};
	/** @type {(error: Error) => void} */
	let rejectReady = () => {};
	const readyPromise = new Promise((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	const handle = new BackendHandle({
		id,
		getCwd: () => cwd,
		getBackendPath,
		sendToRenderer: (channel, payload) => {
			mirrorToFileLog(channel, /** @type {Record<string, unknown>} */ (payload));
			if (channel !== "backend:status") return;
			const status = /** @type {{ ready?: boolean, error?: string }} */ (payload);
			if (status.ready) resolveReady();
			else if (status.error) rejectReady(new Error(status.error));
		},
		isQuitting: () => isQuitting,
	});
	return { handle, readyPromise };
}

/**
 * @template T
 * @param {string} id
 * @param {string} cwd
 * @param {(handle: BackendHandle) => Promise<T>} operation
 */
async function withAutomationHandle(id, cwd, operation) {
	const { handle, readyPromise } = createAutomationHandle(id, cwd);
	automationHandles.add(handle);
	automationBusyHandles.add(handle);
	try {
		handle.start();
		await waitWithTimeout(readyPromise, AUTOMATION_START_TIMEOUT_MS, "Automation backend did not become ready");
		return await operation(handle);
	} finally {
		const child = handle.child;
		automationBusyHandles.delete(handle);
		automationHandles.delete(handle);
		handle.stop();
		await waitForChildExit(child, 5000);
	}
}

/** @param {BackendHandle} handle */
async function captureAutomationSession(handle) {
	if (!handle.ready) return {};
	const state = await requestAutomationBackend(handle, { type: "get_state" });
	if (!state || typeof state !== "object") return {};
	const record = /** @type {Record<string, unknown>} */ (state);
	return {
		...(typeof record.sessionId === "string" && record.sessionId ? { sessionId: record.sessionId } : {}),
		...(typeof record.sessionFile === "string" && record.sessionFile ? { sessionFile: record.sessionFile } : {}),
	};
}

/** @param {BackendHandle} handle @param {string} prompt */
async function runAutomationPrompt(handle, prompt) {
	let runFailure;
	/** @type {(value?: void) => void} */
	let resolveFinished = () => {};
	/** @type {(error: Error) => void} */
	let rejectFinished = () => {};
	const finishedPromise = new Promise((resolve, reject) => {
		resolveFinished = resolve;
		rejectFinished = reject;
	});
	const unsubscribe = handle.onEvent((event) => {
		if (event.type === "auto_retry_end" && event.success === false) {
			runFailure = String(event.finalError ?? "The provider retry budget was exhausted");
		}
		if (event.type === "extension_error") {
			runFailure = String(event.error ?? "An extension failed during the automation");
		}
		if (event.type !== "agent_end" || event.willRetry) return;
		const messages = Array.isArray(event.messages) ? event.messages : [];
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			const message = messages[index];
			if (!message || typeof message !== "object" || Array.isArray(message)) continue;
			const record = /** @type {Record<string, unknown>} */ (message);
			if (record.role !== "assistant") continue;
			if (record.stopReason === "aborted") runFailure = "Automation run was aborted";
			if (record.stopReason === "error") runFailure = String(record.errorMessage ?? "The model request failed");
			break;
		}
		resolveFinished();
	});
	const healthTimer = setInterval(() => {
		if (!handle.ready) rejectFinished(new Error("Automation backend stopped before the run finished"));
	}, 250);
	healthTimer.unref?.();
	try {
		await requestAutomationBackend(handle, { type: "prompt", message: prompt }, { timeoutMs: PROMPT_REQUEST_TIMEOUT_MS });
		await waitWithTimeout(finishedPromise, AUTOMATION_RUN_TIMEOUT_MS, "Automation run timed out after 30 minutes");
		if (runFailure) throw new Error(runFailure);
	} finally {
		clearInterval(healthTimer);
		unsubscribe();
	}
}

/**
 * @param {BackendHandle} handle
 * @param {{ name: string, prompt: string, cwd: string, model?: { provider: string, id: string }, reasoningEffort?: string }} automation
 * @param {{ startedAt: string }} run
 * @param {{ createSession?: boolean, expectedSessionFile?: string, cwd?: string }} options
 */
async function executeAutomationPrompt(handle, automation, run, options = {}) {
	if (options.createSession) {
		const changed = await requestAutomationBackend(handle, { type: "new_session", cwd: options.cwd ?? automation.cwd });
		if (changed && typeof changed === "object" && /** @type {Record<string, unknown>} */ (changed).cancelled) {
			throw new Error("Automation session creation was cancelled");
		}
	} else if (options.expectedSessionFile) {
		const state = await requestAutomationBackend(handle, { type: "get_state" });
		if (!state || typeof state !== "object") throw new Error("Could not read the heartbeat session");
		const record = /** @type {Record<string, unknown>} */ (state);
		if (sessionPathKey(String(record.sessionFile ?? "")) !== sessionPathKey(options.expectedSessionFile)) {
			throw new Error("The heartbeat conversation is no longer open in this task");
		}
		if (record.isStreaming || record.isCompacting) {
			throw new Error("The heartbeat conversation is already running");
		}
	}
	await requestAutomationBackend(handle, { type: "set_extension_flag", name: "permission-mode", value: "auto" });
	if (options.createSession) {
		await requestAutomationBackend(handle, {
			type: "set_session_name",
			name: `Automation: ${automation.name.slice(0, 80)} — ${new Date(run.startedAt).toLocaleString()}`,
		});
	}
	if (automation.model) {
		await requestAutomationBackend(handle, {
			type: "set_model",
			provider: automation.model.provider,
			modelId: automation.model.id,
		});
	}
	if (automation.reasoningEffort) {
		await requestAutomationBackend(handle, { type: "set_thinking_level", level: automation.reasoningEffort });
	}
	await runAutomationPrompt(handle, automation.prompt);
	return captureAutomationSession(handle);
}

/** @param {string} sessionFile */
async function findOpenTaskSessions(sessionFile) {
	const wanted = sessionPathKey(sessionFile);
	const entries = taskRegistry.list().map((entry) => taskRegistry.get(entry.taskId));
	const matches = await Promise.all(entries.map(async (entry) => {
		if (!entry.handle.ready) return undefined;
		try {
			return await entry.handle.mutationQueue.serialize(async () => {
				const response = await entry.handle.request({ type: "get_state" });
				if (!response.success || sessionPathKey(String(response.data?.sessionFile ?? "")) !== wanted) return undefined;
				return { entry };
			});
		} catch {
			return undefined;
		}
	}));
	return matches.filter((match) => match !== undefined);
}

/**
 * @param {{ id: string, name: string, prompt: string, cwd: string, destination: "local" | "worktree", model?: { provider: string, id: string }, reasoningEffort?: string, worktree?: { path: string, branch: string } }} automation
 * @param {{ id: string, startedAt: string }} run
 */
async function runCronAutomation(automation, run) {
	const runCwd = automation.destination === "worktree" ? automation.worktree?.path : automation.cwd;
	if (automation.destination === "worktree" && (!runCwd || !isManagedAutomationWorktree(runCwd))) {
		return { error: "Automation worktree is outside Pi Studio's managed worktree folder" };
	}
	if (!runCwd || !existsSync(runCwd) || !statSync(runCwd).isDirectory()) {
		return { error: `Automation workspace not found: ${runCwd ?? automation.cwd}` };
	}
	/** @type {{ sessionId?: string, sessionFile?: string }} */
	let session = {};
	try {
		return await withAutomationHandle(`automation_${automation.id}_${run.id}`, runCwd, async (handle) => {
			try {
				session = await executeAutomationPrompt(handle, automation, run, { createSession: true, cwd: runCwd });
				return session;
			} catch (error) {
				try {
					session = await captureAutomationSession(handle);
				} catch {
					// Keep the original failure; session capture is best-effort on a dead backend.
				}
				return { ...session, error: error instanceof Error ? error.message : String(error) };
			}
		});
	} catch (error) {
		return { ...session, error: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * @param {{ id: string, name: string, prompt: string, cwd: string, model?: { provider: string, id: string }, reasoningEffort?: string, thread?: { sessionId: string, sessionFile: string, cwd: string } }} automation
 * @param {{ id: string, startedAt: string }} run
 */
async function runHeartbeatAutomation(automation, run) {
	const thread = automation.thread;
	if (!thread?.sessionFile || !thread.sessionId) return { error: "Heartbeat target is missing" };
	if (!existsSync(thread.cwd) || !statSync(thread.cwd).isDirectory()) {
		return { sessionId: thread.sessionId, sessionFile: thread.sessionFile, error: `Heartbeat workspace not found: ${thread.cwd}` };
	}
	const lockKey = sessionPathKey(thread.sessionFile);
	if (automationSessionLocks.has(lockKey)) {
		return { sessionId: thread.sessionId, sessionFile: thread.sessionFile, error: "This conversation is already running an automation" };
	}
	automationSessionLocks.add(lockKey);
	try {
		const matches = await findOpenTaskSessions(thread.sessionFile);
		if (matches.length > 1) throw new Error("The heartbeat conversation is open in more than one task");
		const match = matches[0];
		if (match) {
			if (automationBusyHandles.has(match.entry.handle)) throw new Error("The target task is already running an automation");
			automationBusyHandles.add(match.entry.handle);
			const permissionMode = match.entry.handle.getExtensionFlag("permission-mode") ?? "ask";
			try {
				return await match.entry.handle.mutationQueue.serialize(async () =>
				executeAutomationPrompt(match.entry.handle, automation, run, { expectedSessionFile: thread.sessionFile }));
			} finally {
				try {
					if (permissionMode !== "auto" && match.entry.handle.ready) {
						await requestAutomationBackend(match.entry.handle, {
							type: "set_extension_flag",
							name: "permission-mode",
							value: permissionMode,
						});
					}
				} finally {
					automationBusyHandles.delete(match.entry.handle);
				}
			}
		}

		/** @type {{ sessionId?: string, sessionFile?: string }} */
		let session = { sessionId: thread.sessionId, sessionFile: thread.sessionFile };
		try {
			return await withAutomationHandle(`heartbeat_${automation.id}_${run.id}`, thread.cwd, async (handle) => {
				try {
					const changed = await requestAutomationBackend(handle, { type: "switch_session", sessionPath: thread.sessionFile });
					if (changed && typeof changed === "object" && /** @type {Record<string, unknown>} */ (changed).cancelled) {
						throw new Error("Heartbeat session switch was cancelled");
					}
					session = await executeAutomationPrompt(handle, automation, run, { expectedSessionFile: thread.sessionFile });
					return session;
				} catch (error) {
					try {
						session = await captureAutomationSession(handle);
					} catch {
						// Keep the target identity when the isolated backend is already gone.
					}
					return { ...session, error: error instanceof Error ? error.message : String(error) };
				}
			});
		} catch (error) {
			return { ...session, error: error instanceof Error ? error.message : String(error) };
		}
	} catch (error) {
		return { sessionId: thread.sessionId, sessionFile: thread.sessionFile, error: error instanceof Error ? error.message : String(error) };
	} finally {
		automationSessionLocks.delete(lockKey);
	}
}

/**
 * @param {{ kind: "cron" | "heartbeat" } & Record<string, unknown>} automation
 * @param {{ id: string, startedAt: string }} run
 */
async function runAutomation(automation, run) {
	return automation.kind === "heartbeat"
		? runHeartbeatAutomation(/** @type {Parameters<typeof runHeartbeatAutomation>[0]} */ (/** @type {unknown} */ (automation)), run)
		: runCronAutomation(/** @type {Parameters<typeof runCronAutomation>[0]} */ (/** @type {unknown} */ (automation)), run);
}

/**
 * @param {{ name: string, notificationPolicy: "all" | "failures" }} automation
 * @param {{ status: string, error?: string }} run
 */
function notifyAutomationResult(automation, run) {
	getFileLog().append(
		run.status === "success" ? "info" : "error",
		"automations",
		`${automation.name}: ${run.status}${run.error ? ` (${run.error})` : ""}`,
	);
	if (run.status === "success" && automation.notificationPolicy === "failures") return;
	if (!Notification.isSupported() || (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused())) return;
	try {
		const notification = new Notification({
			title: `${PRODUCT_NAME} Automation`,
			body: run.status === "success"
				? `${automation.name} finished.`
				: `${automation.name} failed: ${run.error ?? "Unknown error"}`,
			icon: getWindowIconPath(),
		});
		notification.on("click", () => focusMainWindow());
		notification.show();
	} catch {
		// Notifications are best-effort; the persisted run record remains authoritative.
	}
}

function getAutomationService() {
	if (!automationService) {
		automationService = createAutomationService({
			filePath: getAutomationsPath(),
			runAutomation,
			onChange: (automations) => sendToRenderer("automation:changed", { automations }),
			onRunComplete: notifyAutomationResult,
			onError: (error) => {
				getFileLog().append("error", "automations", error instanceof Error ? error.message : String(error));
			},
		});
	}
	return automationService;
}

/** @param {unknown} taskId */
async function captureAutomationThread(taskId) {
	const entry = taskRegistry.get(typeof taskId === "string" && taskId ? taskId : undefined);
	const response = await entry.handle.request({ type: "get_state" });
	if (!response.success) throw new Error(response.error || "Could not read the current conversation");
	const state = response.data;
	if (
		!state ||
		typeof state.sessionId !== "string" || !state.sessionId ||
		typeof state.sessionFile !== "string" || !state.sessionFile ||
		typeof state.cwd !== "string" || !state.cwd
	) {
		throw new Error("The current conversation does not have a persistent session file yet");
	}
	return {
		sessionId: state.sessionId,
		sessionFile: state.sessionFile,
		cwd: state.cwd,
		...(typeof state.sessionName === "string" && state.sessionName ? { sessionName: state.sessionName } : {}),
	};
}

/** @param {unknown} input @param {unknown} taskId */
async function createAutomation(input, taskId) {
	const record = input && typeof input === "object" && !Array.isArray(input)
		? /** @type {Record<string, unknown>} */ (input)
		: {};
	if (record.kind === "heartbeat") {
		const thread = await captureAutomationThread(taskId);
		return getAutomationService().create({ ...record, cwd: thread.cwd }, { thread });
	}
	if (record.destination !== "worktree") return getAutomationService().create(input);
	const cwd = String(record.cwd ?? "");
	if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error(`Workspace not found: ${cwd}`);
	if (!(await isGitRepository(cwd))) throw new Error("Worktree automations need a git repository");
	const provisioned = await createTaskWorktree(cwd, getWorktreesRoot());
	try {
		return getAutomationService().create(input, {
			worktree: { path: provisioned.worktreePath, branch: provisioned.branch },
		});
	} catch (error) {
		const cleanup = await removeTaskWorktree(cwd, provisioned.worktreePath);
		if (!cleanup.removed) {
			getFileLog().append("warn", "automations", `Could not clean up rejected automation worktree: ${cleanup.reason}`);
		}
		throw error;
	}
}

/** @param {unknown} id */
async function deleteAutomation(id) {
	const deleted = getAutomationService().delete(id);
	if (!deleted.worktree) return deleted;
	if (!isManagedAutomationWorktree(deleted.worktree.path)) {
		return {
			...deleted,
			worktreeCleanup: { removed: false, reason: "The stored worktree path is outside Pi Studio's managed folder" },
		};
	}
	const cleanup = await removeTaskWorktree(deleted.cwd, deleted.worktree.path);
	return {
		...deleted,
		worktreeCleanup: cleanup.removed
			? { removed: true }
			: { removed: false, reason: cleanup.reason },
	};
}

function automationWorktreePaths() {
	return getAutomationService().list()
		.flatMap((automation) => automation.worktree?.path && isManagedAutomationWorktree(automation.worktree.path)
			? [automation.worktree.path]
			: []);
}

async function createWindow() {
	const isDark = nativeTheme.shouldUseDarkColors;
	const { workAreaSize } = screen.getPrimaryDisplay();
	const savedWindowState = loadWindowState();
	const initialWidth = savedWindowState?.width ?? Math.min(1200, Math.max(980, workAreaSize.width - 16));
	const initialHeight = savedWindowState?.height ?? Math.min(800, Math.max(640, workAreaSize.height - 16));
	const window = new BrowserWindow({
		...(savedWindowState ? { x: savedWindowState.x, y: savedWindowState.y } : {}),
		width: initialWidth,
		height: initialHeight,
		minWidth: 720,
		minHeight: 520,
		center: true,
		title: PRODUCT_NAME,
		icon: getWindowIconPath(),
		show: false,
		titleBarStyle: process.platform === "win32" || process.platform === "darwin" ? "hidden" : "hiddenInset",
		...(process.platform === "win32"
			? {
					titleBarOverlay: {
						color: "#00000000",
						symbolColor: "#85857f",
						height: 36,
					},
				}
			: {}),
		backgroundMaterial: "mica",
		vibrancy: "sidebar",
		backgroundColor: isDark ? "#1e1e1d" : "#f2f2f1",
		autoHideMenuBar: true,
		roundedCorners: true,
		hasShadow: true,
		webPreferences: {
			preload: join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	mainWindow = window;

	window.once("ready-to-show", () => {
		if (savedWindowState?.maximized) window.maximize();
		window.show();
		primaryBackend.start();
	});
	window.on("close", () => saveWindowState(window));
	window.on("closed", () => {
		if (mainWindow === window) mainWindow = undefined;
	});
	window.webContents.setWindowOpenHandler(({ url }) => {
		void openExternalSafely(url).catch((error) => {
			sendToRenderer("backend:log", { level: "error", message: error.message });
		});
		return { action: "deny" };
	});
	window.webContents.on("will-navigate", (event, url) => {
		if (url === window.webContents.getURL()) return;
		event.preventDefault();
		void openExternalSafely(url).catch((error) => {
			sendToRenderer("backend:log", { level: "error", message: error.message });
		});
	});
	window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
	if (process.env.PI_DEV === "1") {
		await window.loadURL("http://localhost:5173");
		window.webContents.openDevTools({ mode: "detach" });
	} else {
		await window.loadFile(getRendererPath());
	}
}

function ensureWindow() {
	initializeBackendCwd();
	initializeTaskSettings();
	getAutomationService();
	if (mainWindow && !mainWindow.isDestroyed()) return Promise.resolve(mainWindow);
	if (windowCreationPromise) return windowCreationPromise;
	windowCreationPromise = createWindow().finally(() => {
		windowCreationPromise = undefined;
	});
	return windowCreationPromise;
}

function focusMainWindow() {
	if (!mainWindow || mainWindow.isDestroyed()) return false;
	if (mainWindow.isMinimized()) mainWindow.restore();
	mainWindow.show();
	mainWindow.focus();
	return true;
}

// Model connectivity tests make a real provider round-trip, so the default 30s
// can spuriously time out on slow endpoints. Give them a longer budget.
const LONG_REQUEST_COMMAND_TIMEOUT_MS = 60000;
const LONG_REQUEST_COMMAND_TYPES = new Set(["test_model", "test_custom_model"]);
const PROMPT_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const PACKAGE_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const SESSION_MUTATION_COMMAND_TYPES = new Set([
	"clone",
	"fork",
	"manage_package",
	"new_session",
	"prompt",
	"set_image_generation_settings",
	"set_session_name",
	"switch_session",
]);
const AUTOMATION_SESSION_COMMAND_TYPES = new Set([
	...SESSION_MUTATION_COMMAND_TYPES,
	"compact",
	"set_extension_flag",
	"set_model",
	"set_thinking_level",
]);

/** @param {{ type?: string } | undefined} command */
function getRequestTimeoutMs(command) {
	if (command?.type === "bash") return 0;
	if (command?.type === "prompt") return PROMPT_REQUEST_TIMEOUT_MS;
	if (command?.type === "manage_package") return PACKAGE_REQUEST_TIMEOUT_MS;
	return command?.type !== undefined && LONG_REQUEST_COMMAND_TYPES.has(command.type)
		? LONG_REQUEST_COMMAND_TIMEOUT_MS
		: undefined;
}

/** @param {() => any} operation */
function serializeSessionMutation(operation) {
	return primaryBackend.mutationQueue.serialize(operation);
}

/** @param {unknown} sessionPath */
async function getKnownSessionFile(sessionPath) {
	const [firstPageResponse, stateResponse] = await Promise.all([
		primaryBackend.request({ type: "get_sessions", all: true, offset: 0, limit: 200 }),
		primaryBackend.request({ type: "get_state" }),
	]);
	if (!firstPageResponse.success) {
		throw new Error(firstPageResponse.error || "Could not list sessions");
	}
	if (!stateResponse.success) {
		throw new Error(stateResponse.error || "Could not read the active session");
	}

	const sessions = [...(firstPageResponse.data?.sessions ?? [])];
	let page = firstPageResponse.data;
	let previousOffset = 0;
	while (page?.hasMore) {
		if (
			page.nextOffset === null ||
			!Number.isSafeInteger(page.nextOffset) ||
			page.nextOffset <= previousOffset
		) {
			throw new Error("Could not paginate sessions safely");
		}
		previousOffset = page.nextOffset;
		const nextPageResponse = await primaryBackend.request({
			type: "get_sessions",
			all: true,
			offset: page.nextOffset,
			limit: 200,
		});
		if (!nextPageResponse.success) {
			throw new Error(nextPageResponse.error || "Could not list sessions");
		}
		const nextPage = nextPageResponse.data;
		if (!nextPage || nextPage.sessions.length === 0) {
			throw new Error("Could not paginate sessions safely");
		}
		sessions.push(...nextPage.sessions);
		page = nextPage;
	}
	return resolveKnownSessionFile(
		sessionPath,
		sessions,
		stateResponse.data?.sessionFile,
	);
}

/**
 * @param {{ handle: BackendHandle }} entry
 * @param {{ type?: string, sessionPath?: unknown } | undefined} command
 */
async function assertAutomationSessionAvailable(entry, command) {
	if (automationSessionLocks.size === 0 || !command?.type) return;
	if (command.type === "switch_session" && isAutomationSessionLocked(command.sessionPath)) {
		throw new Error("An automation heartbeat is currently updating that conversation");
	}
	if (!AUTOMATION_SESSION_COMMAND_TYPES.has(command.type)) return;
	const state = await entry.handle.request({ type: "get_state" });
	if (!state.success) throw new Error(state.error || "Could not read the current conversation");
	if (isAutomationSessionLocked(state.data?.sessionFile)) {
		throw new Error("Wait for the automation heartbeat to finish before changing this conversation");
	}
}

ipcMain.handle("backend:request", async (_event, command, taskId) => {
	const rejection = describeBackendCommandRejection(command, BACKEND_REQUEST_COMMAND_TYPES);
	if (rejection) {
		throw new Error(rejection);
	}
	const entry = taskRegistry.get(taskId);
	const execute = async () => {
		await assertAutomationSessionAvailable(entry, command);
		const timeoutMs = getRequestTimeoutMs(command);
		const response = await entry.handle.request(command, timeoutMs === undefined ? {} : { timeoutMs });
		if (!response.success) {
			throw new Error(response.error || `Command failed: ${response.command}`);
		}
		const data = response.data ?? null;
		if (
			entry.isPrimary &&
			(command?.type === "new_session" || command?.type === "switch_session") &&
			data &&
			typeof data === "object" &&
			typeof data.cwd === "string"
		) {
			syncBackendCwd(data.cwd);
		}
		return data;
	};
	return SESSION_MUTATION_COMMAND_TYPES.has(command?.type)
		? entry.handle.mutationQueue.serialize(execute)
		: execute();
});

ipcMain.handle("backend:send", async (_event, command, taskId) => {
	const rejection = describeBackendCommandRejection(command, BACKEND_SEND_COMMAND_TYPES);
	if (rejection) {
		throw new Error(rejection);
	}
	const entry = taskRegistry.get(taskId);
	await entry.handle.send(command);
	if (command?.type === "extension_ui_response") entry.handle.pendingExtensionUIRequests.remove(command.id);
});

ipcMain.handle("backend:get-pending-extension-ui-requests", (_event, taskId) =>
	taskRegistry.get(taskId).handle.pendingExtensionUIRequests.list(),
);

ipcMain.handle("backend:get-status", (_event, taskId) => taskRegistry.get(taskId).handle.statusSnapshot());

function getWorktreesRoot() {
	return join(app.getPath("userData"), "worktrees");
}

/** @param {string} path */
function isManagedAutomationWorktree(path) {
	return isPathInsideWorktreesRoot(getWorktreesRoot(), path);
}

// --- Pool lifecycle (M4): settings + idle reaping ---

let taskSettings = { ...DEFAULT_TASK_SETTINGS };
let taskSettingsInitialized = false;
// The renderer's currently displayed task; the reaper never touches it.
/** @type {string | undefined} */
let rendererActiveTaskId;

function getTaskSettingsPath() {
	return join(app.getPath("userData"), TASK_SETTINGS_FILE);
}

/** @param {unknown} value */
function clampIdleMinutes(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return taskSettings.idleMinutes;
	return Math.min(MAX_IDLE_MINUTES, Math.max(0, Math.round(parsed)));
}

function initializeTaskSettings() {
	if (taskSettingsInitialized) return;
	taskSettingsInitialized = true;
	try {
		const parsed = JSON.parse(readFileSync(getTaskSettingsPath(), "utf8"));
		if (parsed && typeof parsed === "object") {
			if (parsed.maxTasks !== undefined) taskSettings.maxTasks = Number(parsed.maxTasks);
			if (parsed.idleMinutes !== undefined) taskSettings.idleMinutes = clampIdleMinutes(parsed.idleMinutes);
		}
	} catch {
		// Missing or invalid settings file: defaults apply.
	}
	taskSettings.maxTasks = taskRegistry.setMaxTasks(taskSettings.maxTasks);
}

function persistTaskSettings() {
	try {
		mkdirSync(app.getPath("userData"), { recursive: true });
		writeFileSync(getTaskSettingsPath(), `${JSON.stringify(taskSettings, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
	} catch (error) {
		sendToRenderer("backend:log", {
			level: "warn",
			message: `Could not save task settings: ${error instanceof Error ? error.message : String(error)}`,
		});
	}
}

/** @param {string} taskId */
async function stopTaskAndCleanup(taskId) {
	const entry = taskRegistry.get(taskId);
	if (automationBusyHandles.has(entry.handle)) throw new Error("Wait for the automation to finish before stopping this task");
	const child = entry.handle.child;
	const result = taskRegistry.stop(entry.taskId);
	if (entry.meta?.worktreePath && entry.meta?.sourceRepo) {
		// Give the backend a moment to release its cwd, then remove through Git —
		// never forced, so a dirty local or remote worktree stays.
		await waitForChildExit(child, 5000);
		const removal = await removeRegisteredTaskWorktree(entry.meta.sourceRepo, entry.meta.worktreePath);
		return {
			...result,
			worktreeRemoved: removal.removed,
			...(removal.removed ? {} : { worktreeKeptReason: removal.reason }),
		};
	}
	return result;
}

// Idle sweep: a pool backend with no traffic past the window stops itself;
// session files make resume cheap. PI_STUDIO_IDLE_REAP_MS shortens the window
// and the sweep cadence so tests can observe a reap in seconds.
const idleReapOverrideMs = Number(process.env.PI_STUDIO_IDLE_REAP_MS);
const idleSweepIntervalMs =
	Number.isFinite(idleReapOverrideMs) && idleReapOverrideMs > 0
		? Math.max(1000, Math.round(idleReapOverrideMs / 2))
		: 60_000;

function idleWindowMs() {
	if (Number.isFinite(idleReapOverrideMs) && idleReapOverrideMs > 0) return idleReapOverrideMs;
	return taskSettings.idleMinutes > 0 ? taskSettings.idleMinutes * 60_000 : 0;
}

let idleSweepRunning = false;
setInterval(() => {
	const windowMs = idleWindowMs();
	if (!windowMs || idleSweepRunning || isQuitting) return;
	const idle = taskRegistry.listIdle(Date.now(), windowMs, { skipTaskId: rendererActiveTaskId });
	if (idle.length === 0) return;
	idleSweepRunning = true;
	void (async () => {
		for (const taskId of idle) {
			try {
				const outcome = await stopTaskAndCleanup(taskId);
				sendToRenderer("task:changed", { ...outcome, taskId, reason: "idle" });
			} catch {
				// The task may have been stopped concurrently; the next sweep settles it.
			}
		}
	})().finally(() => {
		idleSweepRunning = false;
	});
}, idleSweepIntervalMs);

/**
 * @param {import("node:child_process").ChildProcess | undefined} child
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
function waitForChildExit(child, timeoutMs) {
	if (!child || child.exitCode !== null || child.signalCode) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, timeoutMs);
		child.once("exit", () => {
			clearTimeout(timer);
			resolve();
		});
	});
}

ipcMain.handle("task:create", async (_event, cwd) => {
	const nextCwd = String(cwd ?? "");
	const remote = resolveSshCwd(nextCwd);
	if (remote) {
		if (!taskRegistry.isClaimed(nextCwd)) return taskRegistry.create(nextCwd);
		taskRegistry.assertCapacity();
		const worktree = await createRemoteTaskWorktree(remote);
		const worktreeCwd = createSshWorkspaceUri(remote.connection.id, worktree.worktreePath);
		try {
			return taskRegistry.create(worktreeCwd, {
				branch: worktree.branch,
				sourceRepo: nextCwd,
				worktreePath: worktreeCwd,
			});
		} catch (error) {
			const cleanup = await removeRegisteredTaskWorktree(nextCwd, worktreeCwd);
			if (!cleanup.removed) {
				getFileLog().append("warn", "tasks", `Could not clean up rejected remote worktree: ${cleanup.reason}`);
			}
			throw error;
		}
	}
	if (!nextCwd || !existsSync(nextCwd) || !statSync(nextCwd).isDirectory()) {
		throw new Error(`Workspace not found: ${nextCwd}`);
	}
	if (!taskRegistry.isClaimed(nextCwd)) {
		return taskRegistry.create(nextCwd);
	}
	// Same-repo parallelism: a claimed git folder gets its own worktree on a
	// fresh task branch; non-git folders keep the refusal.
	taskRegistry.assertCapacity();
	if (!(await isGitRepository(nextCwd))) {
		throw new Error(
			"That folder is already running. Running parallel tasks in one folder needs a git repository (each task gets a worktree).",
		);
	}
	const worktree = await createTaskWorktree(nextCwd, getWorktreesRoot());
	return taskRegistry.create(worktree.worktreePath, {
		branch: worktree.branch,
		sourceRepo: nextCwd,
		worktreePath: worktree.worktreePath,
	});
});

ipcMain.handle("task:list", async () => ({ tasks: taskRegistry.list(), maxTasks: taskRegistry.getMaxTasks() }));

ipcMain.handle("task:stop", async (_event, taskId) => stopTaskAndCleanup(String(taskId ?? "")));

ipcMain.handle("task:get-settings", async () => ({ ...taskSettings, maxTasks: taskRegistry.getMaxTasks() }));

ipcMain.handle("task:configure", async (_event, settings) => {
	if (settings && typeof settings === "object") {
		if (settings.maxTasks !== undefined) {
			taskSettings.maxTasks = taskRegistry.setMaxTasks(settings.maxTasks);
		}
		if (settings.idleMinutes !== undefined) {
			taskSettings.idleMinutes = clampIdleMinutes(settings.idleMinutes);
		}
		persistTaskSettings();
	}
	return { ...taskSettings, maxTasks: taskRegistry.getMaxTasks() };
});

ipcMain.handle("automation:list", async () => ({ automations: getAutomationService().list() }));

ipcMain.handle("automation:create", async (_event, input, taskId) => createAutomation(input, taskId));

ipcMain.handle("automation:update", async (_event, id, input) => getAutomationService().update(id, input));

ipcMain.handle("automation:set-status", async (_event, id, status) => getAutomationService().setStatus(id, status));

ipcMain.handle("automation:delete", async (_event, id) => deleteAutomation(id));

ipcMain.handle("automation:run-now", async (_event, id) => getAutomationService().runNow(id));

ipcMain.handle("automation:update-run", async (_event, automationId, runId, action) =>
	getAutomationService().updateRun(automationId, runId, action),
);

ipcMain.handle("automation:open-run", async (_event, automationId, runId) => {
	const automation = getAutomationService().list().find((candidate) => candidate.id === String(automationId ?? ""));
	const run = automation?.runs.find((candidate) => candidate.id === String(runId ?? ""));
	if (!run?.sessionFile) throw new Error("This run does not have a session file");
	const sessionFile = run.sessionFile;
	if (isAutomationSessionLocked(sessionFile)) throw new Error("Wait for the automation heartbeat to finish");
	const markRead = () => {
		try {
			getAutomationService().updateRun(automationId, runId, "read");
		} catch (error) {
			getFileLog().append("warn", "automations", `Could not mark opened run read: ${error instanceof Error ? error.message : String(error)}`);
		}
	};
	const matches = await findOpenTaskSessions(sessionFile);
	if (matches.length > 1) throw new Error("This automation session is open in more than one task");
	const match = matches[0];
	if (match) {
		const result = await match.entry.handle.mutationQueue.serialize(async () => {
			const state = await match.entry.handle.request({ type: "get_state" });
			if (!state.success) throw new Error(state.error || "Could not read the automation session");
			if (sessionPathKey(String(state.data?.sessionFile ?? "")) !== sessionPathKey(sessionFile)) {
				throw new Error("The automation session moved before it could be opened");
			}
			if (state.data?.isStreaming || state.data?.isCompacting) {
				throw new Error("Finish or stop the current run before opening automation history");
			}
			return { cancelled: false, cwd: String(state.data?.cwd ?? match.entry.cwd()), taskId: match.entry.taskId };
		});
		markRead();
		return result;
	}
	return serializeSessionMutation(async () => {
		const state = await primaryBackend.request({ type: "get_state" });
		if (!state.success) throw new Error(state.error || "Could not read the primary session");
		if (state.data?.isStreaming || state.data?.isCompacting) {
			throw new Error("Finish or stop the primary run before opening automation history");
		}
		const switched = await primaryBackend.request({ type: "switch_session", sessionPath: sessionFile });
		if (!switched.success) throw new Error(switched.error || "Could not open the automation session");
		if (typeof switched.data?.cwd === "string") syncBackendCwd(switched.data.cwd);
		markRead();
		return { ...switched.data, taskId: primaryBackend.id };
	});
});

ipcMain.handle("worktrees:list-leftovers", async () => {
	const activeCwds = [...taskRegistry.list().map((entry) => entry.cwd), ...automationWorktreePaths()];
	const local = await listWorktreeLeftovers(getWorktreesRoot(), activeCwds);
	const remote = getActiveSshWorkspace();
	if (!remote) return { leftovers: local };
	try {
		return { leftovers: [...local, ...(await listRemoteWorktreeLeftovers(remote, activeCwds))] };
	} catch (error) {
		const remoteError = error instanceof Error ? error.message : String(error);
		getFileLog().append("warn", "tasks", remoteError);
		return { leftovers: local, remoteError };
	}
});

ipcMain.handle("worktrees:delete", async (_event, targetPath) => {
	const activeCwds = [...taskRegistry.list().map((entry) => entry.cwd), ...automationWorktreePaths()];
	const target = String(targetPath ?? "");
	const remote = resolveSshCwd(target);
	if (remote) {
		if (getActiveSshWorkspace()?.connection.id !== remote.connection.id) {
			throw new Error("Open that SSH connection before deleting its retained worktree");
		}
		const canonicalTarget = createSshWorkspaceUri(remote.connection.id, remote.remotePath);
		if (activeCwds.includes(canonicalTarget)) throw new Error("A task is still running in that remote worktree");
		await runSshSpec(
			createSshWorktreeDeleteSpec(remote.connection, remote.remotePath),
			"Could not delete the remote task worktree",
		);
		getFileLog().append("info", "tasks", `remote leftover worktree deleted: ${target}`);
		return { deleted: true };
	}
	const result = await deleteLeftoverWorktree(getWorktreesRoot(), target, activeCwds);
	getFileLog().append("info", "tasks", `leftover worktree deleted: ${target}`);
	return result;
});

ipcMain.on("task:activate", (_event, taskId) => {
	rendererActiveTaskId = typeof taskId === "string" && taskId && taskId !== "main" ? taskId : undefined;
	// Switching to a task counts as touching it, so a just-opened quiet task
	// is not reaped out from under the user on the next sweep.
	if (rendererActiveTaskId) {
		try {
			taskRegistry.get(rendererActiveTaskId).handle.lastActivityAt = Date.now();
		} catch {
			rendererActiveTaskId = undefined;
		}
	}
});

ipcMain.handle("backend:open-external", async (_event, url) => {
	await openExternalSafely(url);
});

ipcMain.handle("session:reveal", async (_event, sessionPath) => {
	const session = await getKnownSessionFile(sessionPath);
	shell.showItemInFolder(session.path);
	return { revealed: true };
});

ipcMain.handle("session:trash", async (_event, sessionPath) => {
	return serializeSessionMutation(async () => {
		const session = await getKnownSessionFile(sessionPath);
		if (isAutomationSessionLocked(session.path)) throw new Error("Wait for the automation heartbeat to finish");
		if (session.isActive) {
			throw new Error("Switch away from the active session before deleting it");
		}
		await shell.trashItem(session.path);
		return { trashed: true };
	});
});

ipcMain.handle("session:export", async (_event, sessionPath) => {
	const session = await getKnownSessionFile(sessionPath);
	if (isAutomationSessionLocked(session.path)) throw new Error("Wait for the automation heartbeat to finish");
	const result = await dialog.showSaveDialog(dialogParent(), {
		title: "Export Session JSONL",
		defaultPath: basename(session.path),
		filters: [{ name: "JSONL", extensions: ["jsonl"] }],
	});
	if (result.canceled || !result.filePath) {
		return { exported: false };
	}
	await copyFile(session.path, result.filePath);
	return { exported: true, path: result.filePath };
});

ipcMain.handle("session:import", async () => {
	return serializeSessionMutation(async () => {
		const stateResponse = await primaryBackend.request({ type: "get_state" });
		if (!stateResponse.success) {
			throw new Error(stateResponse.error || "Could not read the active session");
		}
		const activeSessionFile = stateResponse.data?.sessionFile;
		if (typeof activeSessionFile !== "string" || !activeSessionFile) {
			throw new Error("The sessions folder is not available yet");
		}
		const picked = await dialog.showOpenDialog(dialogParent(), {
			title: "Import Session JSONL",
			filters: [{ name: "JSONL", extensions: ["jsonl"] }],
			properties: ["openFile"],
		});
		if (picked.canceled || picked.filePaths.length === 0) {
			return { imported: false };
		}
		const targetPath = await prepareSessionImport(picked.filePaths[0], dirname(activeSessionFile));
		const switched = await primaryBackend.request({ type: "switch_session", sessionPath: targetPath });
		if (!switched.success) {
			throw new Error(switched.error || "Could not open the imported session");
		}
		return { imported: true, path: targetPath };
	});
});

ipcMain.handle("provider:fetch-models", async (_event, params) => {
	return fetchProviderModels(params ?? {});
});

ipcMain.handle("clipboard:write-text", (_event, text) => {
	clipboard.writeText(String(text ?? ""));
});

ipcMain.handle("app:get-info", () => ({
	name: PRODUCT_NAME,
	version: app.getVersion(),
}));

ipcMain.handle("app:get-changelog", () => {
	// Lives next to src/ both in development and inside the packaged asar.
	const markdown = readFileSync(join(__dirname, "..", "CHANGELOG.md"), "utf8");
	return { markdown: markdown.slice(0, 512 * 1024) };
});

ipcMain.handle("app:check-for-updates", async () => checkDesktopUpdate(app.getVersion()));

ipcMain.handle("diagnostics:save", async (_event, rendererDiagnostics) => {
	const diagnostics = sanitizeDiagnostics({
		generatedAt: new Date().toISOString(),
		product: PRODUCT_NAME,
		appVersion: app.getVersion(),
		electronVersion: process.versions.electron,
		platform: process.platform,
		arch: process.arch,
		backend: {
			ready: primaryBackend.ready,
			starting: primaryBackend.starting,
			cwd: backendCwd,
			path: getBackendPath(),
		},
		renderer: rendererDiagnostics,
	}, app.getPath("home"));
	const contents = `${JSON.stringify(diagnostics, null, 2)}\n`;
	if (Buffer.byteLength(contents, "utf8") > 1024 * 1024) {
		throw new Error("Diagnostics exceed the 1 MB size limit");
	}
	const date = new Date().toISOString().slice(0, 10);
	const result = await dialog.showSaveDialog(dialogParent(), {
		title: "Export Pi Studio diagnostics",
		defaultPath: join(app.getPath("documents"), `pi-studio-diagnostics-${date}.json`),
		filters: [{ name: "JSON", extensions: ["json"] }],
	});
	if (result.canceled || !result.filePath) return { saved: false };
	await writeFile(result.filePath, contents, { encoding: "utf8", mode: 0o600 });
	return { saved: true, path: result.filePath };
});

ipcMain.handle("model-config:save", async (_event, backup) => {
	if (!backup || typeof backup !== "object" || backup.format !== "pi-studio-models" || backup.version !== 1) {
		throw new Error("Invalid Pi Studio model backup");
	}
	const contents = `${JSON.stringify(backup, null, 2)}\n`;
	if (Buffer.byteLength(contents, "utf8") > 1024 * 1024) throw new Error("Model backup exceeds the 1 MB size limit");
	if (/"[^"]*(?:api[-_]?key|authorization|token|secret|password|cookie)[^"]*"\s*:/i.test(contents)) {
		throw new Error("Model backups cannot contain credentials");
	}
	const result = await dialog.showSaveDialog(dialogParent(), {
		title: "Export Pi Studio model configuration",
		defaultPath: join(app.getPath("documents"), "pi-studio-models.json"),
		filters: [{ name: "JSON", extensions: ["json"] }],
	});
	if (result.canceled || !result.filePath) return { saved: false };
	await writeFile(result.filePath, contents, { encoding: "utf8", mode: 0o600 });
	return { saved: true, path: result.filePath };
});

ipcMain.handle("model-config:open", async () => {
	const result = await dialog.showOpenDialog(dialogParent(), {
		title: "Import Pi Studio model configuration",
		properties: ["openFile"],
		filters: [{ name: "JSON", extensions: ["json"] }],
	});
	if (result.canceled || result.filePaths.length === 0) return { opened: false };
	const contents = await readFile(result.filePaths[0], "utf8");
	if (Buffer.byteLength(contents, "utf8") > 1024 * 1024) throw new Error("Model backup exceeds the 1 MB size limit");
	const backup = JSON.parse(contents);
	if (
		!backup ||
		typeof backup !== "object" ||
		backup.format !== "pi-studio-models" ||
		backup.version !== 1 ||
		!backup.providers ||
		typeof backup.providers !== "object" ||
		Array.isArray(backup.providers)
	) {
		throw new Error("Unsupported Pi Studio model backup format");
	}
	return { opened: true, backup };
});

ipcMain.handle("backend:restart", async () => {
	if (automationBusyHandles.has(primaryBackend)) throw new Error("Wait for the automation to finish before restarting the backend");
	primaryBackend.stop();
	primaryBackend.start();
});

ipcMain.handle("ssh:list", () => {
	const connections = loadSshConnections(getSshConnectionsPath());
	let activeConnectionId;
	try {
		activeConnectionId = getActiveSshWorkspace()?.connection.id;
	} catch {
		activeConnectionId = undefined;
	}
	return { connections, activeConnectionId };
});

ipcMain.handle("ssh:save", (_event, input) => {
	const current = loadSshConnections(getSshConnectionsPath());
	const result = upsertSshConnection(current, input);
	saveSshConnections(getSshConnectionsPath(), result.connections);
	return result;
});

ipcMain.handle("ssh:delete", (_event, connectionId) => {
	const id = String(connectionId ?? "").trim().toLowerCase();
	const current = loadSshConnections(getSshConnectionsPath());
	if (!current.some((connection) => connection.id === id)) throw new Error(`SSH connection not found: ${id}`);
	const inUse = taskRegistry.list().some(({ cwd }) => resolveSshCwd(cwd)?.connection.id === id);
	if (inUse) {
		throw new Error("Stop its tasks and open a local workspace before deleting this SSH connection");
	}
	const connections = current.filter((connection) => connection.id !== id);
	saveSshConnections(getSshConnectionsPath(), connections);
	return { connections };
});

ipcMain.handle("ssh:test", async (_event, input) => testSshConnection(normalizeSshConnection(input)));

ipcMain.handle("ssh:install-pi", async (_event, input) => {
	const version = app.getVersion().match(/^(\d+\.\d+\.\d+)/u)?.[1];
	if (!version) throw new Error(`Pi Studio version is invalid: ${app.getVersion()}`);
	const spec = createSshPiInstallSpec(normalizeSshConnection(input), version);
	await runSshSpec(spec, "Could not install Pi on the SSH host", 10 * 60_000);
	return {
		piCommand: spec.piCommand,
		version: spec.piVersion,
		nodeVersion: spec.nodeVersion,
	};
});

ipcMain.handle("ssh:connect", async (_event, connectionId) => {
	if (automationBusyHandles.has(primaryBackend)) throw new Error("Wait for the automation to finish before changing workspace");
	const id = String(connectionId ?? "").trim().toLowerCase();
	const connection = loadSshConnections(getSshConnectionsPath()).find((candidate) => candidate.id === id);
	if (!connection) throw new Error(`SSH connection not found: ${id}`);
	const cwd = createSshWorkspaceUri(connection.id, connection.remotePath);
	const changed = cwd !== backendCwd;
	backendCwd = cwd;
	persistBackendCwd();
	primaryBackend.stop();
	primaryBackend.start();
	return { cwd, changed, connectionId: connection.id };
});

// Folder picker with an unambiguous cancel signal; workspace:choose overloads
// "changed:false" for both cancel and picking the current folder, which the
// same-repo task flow must distinguish.
ipcMain.handle("dialog:pick-folder", async () => {
	const result = await dialog.showOpenDialog(dialogParent(), {
		title: "Choose Task Folder",
		...(backendCwd.startsWith("ssh://") ? {} : { defaultPath: backendCwd }),
		properties: ["openDirectory"],
	});
	if (result.canceled || result.filePaths.length === 0) {
		return { canceled: true };
	}
	return { canceled: false, cwd: result.filePaths[0] };
});

ipcMain.handle("workspace:choose", async () => {
	const result = await dialog.showOpenDialog(dialogParent(), {
		title: "Open Workspace",
		...(backendCwd.startsWith("ssh://") ? {} : { defaultPath: backendCwd }),
		properties: ["openDirectory"],
	});
	if (result.canceled || result.filePaths.length === 0) {
		return { cwd: backendCwd, changed: false };
	}
	return { cwd: result.filePaths[0], changed: result.filePaths[0] !== backendCwd };
});

ipcMain.handle("workspace:open", async (_event, cwd) => {
	if (automationBusyHandles.has(primaryBackend)) throw new Error("Wait for the automation to finish before changing workspace");
	const nextCwd = String(cwd ?? "");
	if (!nextCwd || !existsSync(nextCwd) || !statSync(nextCwd).isDirectory()) {
		throw new Error(`Workspace not found: ${nextCwd}`);
	}
	backendCwd = nextCwd;
	persistBackendCwd();
	primaryBackend.stop();
	primaryBackend.start();
	return { cwd: backendCwd, changed: true };
});

ipcMain.handle("workspace:get", async () => ({ cwd: backendCwd, taskCwd: getTaskWorkspacePath() }));

ipcMain.handle("project:create", async (_event, { template, parentDir, projectName } = {}) => {
	if (!template || typeof template !== "string" || !template.trim()) {
		throw new Error("A template name is required");
	}
	if (!parentDir || typeof parentDir !== "string" || !parentDir.trim()) {
		throw new Error("A parent directory is required");
	}
	if (!projectName || typeof projectName !== "string" || !projectName.trim()) {
		throw new Error("A project name is required");
	}
	return createProject(template, parentDir, projectName);
});

// Presets travel with the status so the renderer never keeps a second copy of
// the mirror list that could drift from the one actually written to disk.
ipcMain.handle("mirror:get-status", async () => {
	const { sources } = await readStatus();
	return { sources, presets: MIRROR_PRESETS };
});

ipcMain.handle("mirror:set-source", async (_event, { manager, sourceId } = {}) => {
	if (!manager || typeof manager !== "string") {
		throw new Error("A package manager is required");
	}
	if (!sourceId || typeof sourceId !== "string") {
		throw new Error("A mirror source is required");
	}
	const knownManager = MIRROR_MANAGERS.find((candidate) => candidate === manager);
	if (!knownManager) throw new Error(`Unknown package manager: ${manager}`);
	return applySource(knownManager, sourceId);
});

// Git and workspace-scoped IPC follows the renderer's active task: a pool
// task (worktree or plain) gets its own folder's git state, not the primary's.
/** @param {unknown} taskId */
function resolveTaskCwd(taskId) {
	return taskRegistry.get(typeof taskId === "string" && taskId ? taskId : undefined).cwd();
}

/** @param {unknown} taskId */
function resolveTaskWorkspace(taskId) {
	const cwd = resolveTaskCwd(taskId);
	return { cwd, remote: resolveSshCwd(cwd) };
}

/** @param {NonNullable<ReturnType<typeof getActiveSshWorkspace>>} remote */
function createRemoteCliExecFile(remote) {
	/**
	 * @param {string} file
	 * @param {readonly string[]} args
	 * @param {import("node:child_process").ExecFileOptionsWithStringEncoding} options
	 * @param {(error: import("node:child_process").ExecFileException | null, stdout: string, stderr: string) => void} callback
	 */
	const remoteExecFile = (file, args, options, callback) => {
		if (file !== "git" && file !== "gh") throw new Error("Remote Git execution only supports git and gh");
		const spec = createSshCliSpec(remote.connection, remote.remotePath, file, args);
		return execFile(spec.command, spec.args, { ...options, cwd: spec.cwd }, callback);
	};
	return /** @type {typeof execFile} */ (/** @type {unknown} */ (remoteExecFile));
}

/**
 * @param {NonNullable<ReturnType<typeof getActiveSshWorkspace>>} remote
 * @param {string} filePath
 */
function trashRemoteGitPath(remote, filePath) {
	const spec = createSshTrashSpec(remote.connection, remote.remotePath, filePath);
	return new Promise((resolve, reject) => {
		execFile(
			spec.command,
			spec.args,
			{
				cwd: spec.cwd,
				encoding: "utf8",
				maxBuffer: 256 * 1024,
				shell: false,
				timeout: 30_000,
				windowsHide: true,
			},
			(error, stdout, stderr) => {
				if (!error) {
					resolve({ path: spec.trashPath });
					return;
				}
				const detail = (stderr.trim() || stdout.trim() || error.message).slice(0, 500);
				reject(new Error(`Could not move the remote file to trash: ${detail}`));
			},
		);
	});
}

/** @param {unknown} taskId */
function resolveGitTarget(taskId) {
	const { cwd: displayCwd, remote } = resolveTaskWorkspace(taskId);
	if (!remote) return { displayCwd, cwd: displayCwd, remote: null, options: undefined };
	return {
		displayCwd,
		cwd: remote.remotePath,
		remote,
		options: {
			execFileImpl: createRemoteCliExecFile(remote),
			realpathImpl: async (/** @type {string} */ _path) => remote.remotePath,
			statImpl: async (/** @type {string} */ _path) => ({ isDirectory: () => true }),
			timeoutMs: 30_000,
			posixPaths: true,
		},
	};
}

ipcMain.handle("workspace:get-git-status", async (_event, taskId) => {
	const target = resolveGitTarget(taskId);
	return { cwd: target.displayCwd, ...(await getGitWorkspaceStatus(target.cwd, target.options)) };
});

ipcMain.handle("git:changes", async (_event, taskId) => {
	const target = resolveGitTarget(taskId);
	return listGitChanges(target.cwd, target.options);
});

ipcMain.handle("git:commit-all", async (_event, message, taskId) => {
	const target = resolveGitTarget(taskId);
	return commitAllChanges(target.cwd, message, target.options);
});

ipcMain.handle("git:branches", async (_event, taskId) => {
	const target = resolveGitTarget(taskId);
	return listGitBranches(target.cwd, target.options);
});

ipcMain.handle("git:file-diff", async (_event, filePath, taskId) => {
	const target = resolveGitTarget(taskId);
	return getFileDiff(target.cwd, String(filePath ?? ""), target.options);
});

ipcMain.handle("git:apply-hunk", async (_event, params, taskId) => {
	const target = resolveGitTarget(taskId);
	return applyGitHunk(target.cwd, String(params?.filePath ?? ""), {
		section: params?.section,
		action: params?.action,
		hunkIndex: params?.hunkIndex,
		patchHash: params?.patchHash,
	}, target.options);
});

ipcMain.handle("git:restore-file", async (_event, filePath, taskId) => {
	const target = resolveGitTarget(taskId);
	const path = String(filePath ?? "");
	const result = await restoreFileChanges(target.cwd, path, target.options);
	if (result.restored || !result.untracked) {
		return { ...result, trashed: false };
	}
	if (target.remote) {
		await trashRemoteGitPath(target.remote, path);
		return { ...result, trashed: true };
	}
	// A file git never knew about: recycle it (recoverable) instead of
	// deleting, and only ever inside the workspace.
	const absolutePath = resolveWorkspacePath(target.cwd, path);
	const { insideWorkspace } = describeRevealTarget(target.cwd, absolutePath);
	if (!insideWorkspace) {
		throw new Error(`Path is outside the workspace: ${absolutePath}`);
	}
	if (existsSync(absolutePath)) {
		await shell.trashItem(absolutePath);
		return { ...result, trashed: true };
	}
	return { ...result, trashed: false };
});

ipcMain.handle("git:push", async (_event, taskId) => {
	const target = resolveGitTarget(taskId);
	return pushCurrentBranch(target.cwd, target.options);
});

ipcMain.handle("git:switch-branch", async (_event, name, options, taskId) => {
	const target = resolveGitTarget(taskId);
	return switchGitBranch(target.cwd, name, { ...target.options, create: Boolean(options?.create) });
});

ipcMain.handle("git:pr-context", async (_event, taskId) => {
	const target = resolveGitTarget(taskId);
	return getPullRequestContext(target.cwd, target.options);
});

ipcMain.handle("git:pr-review", async (_event, taskId) => {
	const target = resolveGitTarget(taskId);
	return getPullRequestReview(target.cwd, target.options);
});

ipcMain.handle("git:pr-review-action", async (_event, action, taskId) => {
	const target = resolveGitTarget(taskId);
	return updatePullRequestReview(target.cwd, action, target.options);
});

ipcMain.handle("git:create-pr", async (_event, params, taskId) => {
	const target = resolveGitTarget(taskId);
	const result = await createPullRequest(target.cwd, {
		title: String(params?.title ?? ""),
		body: String(params?.body ?? ""),
		base: String(params?.base ?? ""),
	}, target.options);
	// Land the user on the PR (gh) or the pre-filled compare page (no gh).
	if (result.url) {
		await openExternalSafely(result.url);
	}
	return result;
});

ipcMain.handle("workspace:list-files", async (_event, query, taskId) => ({
	files: listWorkspaceFiles(resolveTaskCwd(taskId), String(query ?? "")),
}));

ipcMain.handle("workspace:reveal", async (_event, cwd) => {
	const targetCwd = typeof cwd === "string" && cwd.length > 0 ? cwd : backendCwd;
	if (targetCwd.startsWith("ssh://")) {
		throw new Error("Remote workspace reveal is not available yet");
	}
	if (!targetCwd || !existsSync(targetCwd) || !statSync(targetCwd).isDirectory()) {
		throw new Error(`Workspace not found: ${targetCwd}`);
	}
	const error = await shell.openPath(targetCwd);
	if (error) {
		throw new Error(error);
	}
	return { opened: true };
});

ipcMain.handle("workspace:reveal-path", async (_event, targetPath, taskId) => {
	const target = resolveTaskWorkspace(taskId);
	const path = String(targetPath ?? "");
	if (target.remote) {
		const localPath = await materializeSshArtifact(target.remote, path, getRemoteArtifactCachePath());
		shell.showItemInFolder(localPath);
		return { revealed: true, path: localPath, insideWorkspace: true, remote: true };
	}
	const absolutePath = resolveWorkspacePath(target.cwd, path);
	if (!existsSync(absolutePath)) {
		throw new Error(`Path not found: ${absolutePath}`);
	}
	const { insideWorkspace } = describeRevealTarget(target.cwd, absolutePath);
	if (!insideWorkspace) {
		throw new Error(`Path is outside the workspace: ${absolutePath}`);
	}
	shell.showItemInFolder(absolutePath);
	return { revealed: true, path: absolutePath, insideWorkspace };
});

ipcMain.handle("workspace:open-path", async (_event, targetPath, taskId) => {
	const target = resolveTaskWorkspace(taskId);
	const path = String(targetPath ?? "");
	const absolutePath = target.remote
		? await materializeSshArtifact(target.remote, path, getRemoteArtifactCachePath())
		: (await resolveWorkspaceFilePath(target.cwd, path)).absolutePath;
	const error = await shell.openPath(absolutePath);
	if (error) throw new Error(error);
	return { opened: true, path: absolutePath, remote: Boolean(target.remote) };
});

ipcMain.handle("workspace:read-file", async (_event, targetPath, taskId) => {
	const target = resolveTaskWorkspace(taskId);
	const path = String(targetPath ?? "");
	return target.remote
		? readSshArtifactPreview(target.remote, path)
		: readWorkspaceFilePreview(target.cwd, path);
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
	app.quit();
} else {
	app.on("second-instance", () => {
		void app.whenReady().then(async () => {
			if (!focusMainWindow()) {
				await ensureWindow();
				focusMainWindow();
			}
		});
	});
	app.whenReady().then(async () => {
		await ensureWindow();
		app.on("activate", async () => {
			if (BrowserWindow.getAllWindows().length === 0) {
				await ensureWindow();
			}
		});
	});
}

ipcMain.handle("logs:reveal", async () => {
	const logsDir = join(app.getPath("userData"), "logs");
	getFileLog(); // Ensure the directory and current file exist before opening.
	const error = await shell.openPath(logsDir);
	if (error) {
		throw new Error(error);
	}
	return { opened: true };
});

app.on("before-quit", () => {
	isQuitting = true;
	getFileLog().append("info", "main", "quitting");
	automationService?.stop();
	for (const handle of automationHandles) handle.stop();
	automationHandles.clear();
	automationBusyHandles.clear();
	automationSessionLocks.clear();
	taskRegistry.stopAll();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});
