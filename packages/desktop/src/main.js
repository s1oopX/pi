import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, Notification, screen, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
	BACKEND_REQUEST_COMMAND_TYPES,
	BACKEND_SEND_COMMAND_TYPES,
	describeBackendCommandRejection,
} from "./backend-command-allowlist.js";
import { BackendHandle } from "./backend-handle.js";
import { sanitizeDiagnostics } from "./diagnostics.js";
import { commitAllChanges, listGitBranches, listGitChanges, pushCurrentBranch, switchGitBranch } from "./git-commit.js";
import { createPullRequest, getPullRequestContext } from "./git-pr.js";
import { getGitWorkspaceStatus } from "./git-workspace-status.js";
import {
	createTaskWorktree,
	deleteLeftoverWorktree,
	isGitRepository,
	listWorktreeLeftovers,
	removeTaskWorktree,
} from "./git-worktree.js";
import { describeRevealTarget, resolveWorkspacePath } from "./path-reveal.js";
import { createRollingLog } from "./rolling-log.js";
import { prepareSessionImport, resolveKnownSessionFile } from "./session-files.js";
import { createTaskRegistry } from "./task-registry.js";
import { checkDesktopUpdate } from "./update.js";
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
const MAX_IDLE_MINUTES = 240;
const DEFAULT_TASK_SETTINGS = { maxTasks: 3, idleMinutes: 30 };

/** @type {import("electron").BrowserWindow | undefined} */
let mainWindow;
/** @type {Promise<void> | undefined} */
let windowCreationPromise;
let backendCwd = process.env.PI_DESKTOP_CWD || process.cwd();
let isQuitting = false;
let workspaceStateInitialized = false;

// Every backend child and its per-process state lives in a BackendHandle
// (src/backend-handle.js); the task registry owns the pool of them
// (src/task-registry.js). The primary follows the workspace; pool members are
// pinned to the folder they were created for.
const primaryBackend = new BackendHandle({
	id: "main",
	getCwd: () => backendCwd,
	getBackendPath,
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
			getBackendPath,
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

function initializeBackendCwd() {
	if (workspaceStateInitialized) return;
	workspaceStateInitialized = true;
	if (process.env.PI_DESKTOP_CWD) return;
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
	if (typeof cwd !== "string" || !cwd.trim() || backendCwd === cwd) return;
	backendCwd = cwd;
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
const SESSION_MUTATION_COMMAND_TYPES = new Set([
	"clone",
	"fork",
	"new_session",
	"prompt",
	"set_session_name",
	"switch_session",
]);

/** @param {{ type?: string } | undefined} command */
function getRequestTimeoutMs(command) {
	if (command?.type === "bash") return 0;
	if (command?.type === "prompt") return PROMPT_REQUEST_TIMEOUT_MS;
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

ipcMain.handle("backend:request", async (_event, command, taskId) => {
	const rejection = describeBackendCommandRejection(command, BACKEND_REQUEST_COMMAND_TYPES);
	if (rejection) {
		throw new Error(rejection);
	}
	const entry = taskRegistry.get(taskId);
	const execute = async () => {
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
	const child = entry.handle.child;
	const result = taskRegistry.stop(entry.taskId);
	if (entry.meta?.worktreePath && entry.meta?.sourceRepo) {
		// The backend process holds the worktree cwd open on Windows; give it a
		// moment to exit, then remove — never forced, a dirty worktree stays.
		await waitForChildExit(child, 5000);
		const removal = await removeTaskWorktree(entry.meta.sourceRepo, entry.meta.worktreePath);
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

ipcMain.handle("worktrees:list-leftovers", async () => {
	const activeCwds = taskRegistry.list().map((entry) => entry.cwd);
	return { leftovers: await listWorktreeLeftovers(getWorktreesRoot(), activeCwds) };
});

ipcMain.handle("worktrees:delete", async (_event, targetPath) => {
	const activeCwds = taskRegistry.list().map((entry) => entry.cwd);
	const result = await deleteLeftoverWorktree(getWorktreesRoot(), String(targetPath ?? ""), activeCwds);
	getFileLog().append("info", "tasks", `leftover worktree deleted: ${targetPath}`);
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
		if (session.isActive) {
			throw new Error("Switch away from the active session before deleting it");
		}
		await shell.trashItem(session.path);
		return { trashed: true };
	});
});

ipcMain.handle("session:export", async (_event, sessionPath) => {
	const session = await getKnownSessionFile(sessionPath);
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
	primaryBackend.stop();
	primaryBackend.start();
});

// Folder picker with an unambiguous cancel signal; workspace:choose overloads
// "changed:false" for both cancel and picking the current folder, which the
// same-repo task flow must distinguish.
ipcMain.handle("dialog:pick-folder", async () => {
	const result = await dialog.showOpenDialog(dialogParent(), {
		title: "Choose Task Folder",
		defaultPath: backendCwd,
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
		defaultPath: backendCwd,
		properties: ["openDirectory"],
	});
	if (result.canceled || result.filePaths.length === 0) {
		return { cwd: backendCwd, changed: false };
	}
	return { cwd: result.filePaths[0], changed: result.filePaths[0] !== backendCwd };
});

ipcMain.handle("workspace:open", async (_event, cwd) => {
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

// Git and workspace-scoped IPC follows the renderer's active task: a pool
// task (worktree or plain) gets its own folder's git state, not the primary's.
/** @param {unknown} taskId */
function resolveTaskCwd(taskId) {
	return taskRegistry.get(typeof taskId === "string" && taskId ? taskId : undefined).cwd();
}

ipcMain.handle("workspace:get-git-status", async (_event, taskId) => {
	const cwd = resolveTaskCwd(taskId);
	return { cwd, ...(await getGitWorkspaceStatus(cwd)) };
});

ipcMain.handle("git:changes", async (_event, taskId) => listGitChanges(resolveTaskCwd(taskId)));

ipcMain.handle("git:commit-all", async (_event, message, taskId) =>
	commitAllChanges(resolveTaskCwd(taskId), message),
);

ipcMain.handle("git:branches", async (_event, taskId) => listGitBranches(resolveTaskCwd(taskId)));

ipcMain.handle("git:push", async (_event, taskId) => pushCurrentBranch(resolveTaskCwd(taskId)));

ipcMain.handle("git:switch-branch", async (_event, name, options, taskId) =>
	switchGitBranch(resolveTaskCwd(taskId), name, { create: Boolean(options?.create) }),
);

ipcMain.handle("git:pr-context", async (_event, taskId) => getPullRequestContext(resolveTaskCwd(taskId)));

ipcMain.handle("git:create-pr", async (_event, params, taskId) => {
	const result = await createPullRequest(resolveTaskCwd(taskId), {
		title: String(params?.title ?? ""),
		body: String(params?.body ?? ""),
		base: String(params?.base ?? ""),
	});
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
	const taskCwd = resolveTaskCwd(taskId);
	const absolutePath = resolveWorkspacePath(taskCwd, String(targetPath ?? ""));
	if (!existsSync(absolutePath)) {
		throw new Error(`Path not found: ${absolutePath}`);
	}
	const { insideWorkspace } = describeRevealTarget(taskCwd, absolutePath);
	if (!insideWorkspace) {
		throw new Error(`Path is outside the workspace: ${absolutePath}`);
	}
	shell.showItemInFolder(absolutePath);
	return { revealed: true, path: absolutePath, insideWorkspace };
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
	taskRegistry.stopAll();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});
