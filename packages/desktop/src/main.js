import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, Notification, screen, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createBackendMutationQueue } from "./backend-mutation-queue.js";
import { sanitizeDiagnostics } from "./diagnostics.js";
import { getGitWorkspaceStatus } from "./git-workspace-status.js";
import { resolveKnownSessionFile } from "./session-files.js";
import { checkDesktopUpdate } from "./update.js";
import { loadStoredWorkspace, saveStoredWorkspace } from "./workspace-state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRODUCT_NAME = "Pi Studio";
const WINDOW_STATE_FILE = "window-state.json";
const WORKSPACE_STATE_FILE = "workspace-state.json";
const TASK_WORKSPACE_DIRECTORY = "tasks";

let mainWindow;
let windowCreationPromise;
let backend;
let backendBuffer = "";
let backendBufferBytes = 0;
let requestCounter = 0;
const pendingRequests = new Map();
let backendReady = false;
let backendStarting = false;
let backendStderr = "";
let backendCwd = process.env.PI_DESKTOP_CWD || process.cwd();
let backendRestartTimer;
let backendStableTimer;
let backendRestartAttempts = 0;
let backendRetryAt = 0;
let isQuitting = false;
let workspaceStateInitialized = false;
const sessionMutationQueue = createBackendMutationQueue();

// RPC messages include inline base64 image content. Keep a bounded but large
// enough frame buffer for multi-image prompts and get_messages responses.
const MAX_BACKEND_BUFFER_BYTES = 128 * 1024 * 1024;
const MAX_BACKEND_STDERR_BYTES = 64 * 1024;
const MAX_BACKEND_RESTART_ATTEMPTS = 3;

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

function syncBackendCwd(cwd) {
	if (typeof cwd !== "string" || !cwd.trim() || backendCwd === cwd) return;
	backendCwd = cwd;
	persistBackendCwd();
	sendToRenderer("backend:status", {
		ready: backendReady,
		starting: backendStarting,
		restarting: Boolean(backendRestartTimer),
		retryInMs: backendRetryAt ? Math.max(0, backendRetryAt - Date.now()) : 0,
		restartAttempts: backendRestartAttempts,
		backendPath: getBackendPath(),
		cwd: backendCwd,
	});
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

function listWorkspaceFiles(root, query = "") {
	if (!root || !existsSync(root)) {
		return [];
	}
	const normalizedQuery = query.trim().toLowerCase();
	const files = [];
	const maxFiles = 180;
	const maxDepth = 4;

	const walk = (directory, depth) => {
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

function sendToRenderer(channel, payload) {
	if (!mainWindow || mainWindow.isDestroyed()) {
		return;
	}
	mainWindow.webContents.send(channel, payload);
}

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
			.map((entry) => {
				if (typeof entry === "string") return { id: entry };
				if (entry && typeof entry === "object" && typeof entry.id === "string") {
					return {
						id: entry.id,
						name: typeof entry.display_name === "string" ? entry.display_name : undefined,
					};
				}
				return undefined;
			})
			.filter((m) => m && m.id)
			.slice(0, 500);

		return { models };
	}

	throw new Error(lastError || "Could not fetch models from endpoint");
}

function parseBackendLine(line) {
	if (!line.trim()) {
		return;
	}
	let payload;
	try {
		payload = JSON.parse(line);
	} catch {
		sendToRenderer("backend:log", { level: "warn", message: line.slice(0, 16 * 1024) });
		return;
	}

	if (payload.type === "response" && payload.id && pendingRequests.has(payload.id)) {
		const pending = pendingRequests.get(payload.id);
		pendingRequests.delete(payload.id);
		clearTimeout(pending.timeout);
		pending.resolve(payload);
		return;
	}

	maybeNotify(payload);
	sendToRenderer("backend:event", payload);
}

// Surface a desktop notification when a run finishes while the window is not
// focused, so the user can look away during long agent runs.
function maybeNotify(payload) {
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
			body: "The agent finished responding.",
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

function handleBackendStdout(chunk) {
	backendBuffer += chunk.toString("utf8");
	backendBufferBytes += chunk.length;
	if (backendBufferBytes > MAX_BACKEND_BUFFER_BYTES && !backendBuffer.includes("\n")) {
		backendBuffer = "";
		backendBufferBytes = 0;
		sendToRenderer("backend:log", { level: "error", message: "Discarded an oversized backend output line" });
		return;
	}
	let newlineIndex = backendBuffer.indexOf("\n");
	while (newlineIndex !== -1) {
		const line = backendBuffer.slice(0, newlineIndex);
		backendBuffer = backendBuffer.slice(newlineIndex + 1);
		backendBufferBytes = Buffer.byteLength(backendBuffer, "utf8");
		parseBackendLine(line);
		newlineIndex = backendBuffer.indexOf("\n");
	}
}

function rejectPendingRequests(error) {
	for (const pending of pendingRequests.values()) {
		clearTimeout(pending.timeout);
		pending.reject(error);
	}
	pendingRequests.clear();
}

function clearBackendRestartTimers() {
	clearTimeout(backendRestartTimer);
	clearTimeout(backendStableTimer);
	backendRestartTimer = undefined;
	backendStableTimer = undefined;
	backendRetryAt = 0;
}

function scheduleBackendRestart(reason) {
	clearTimeout(backendStableTimer);
	backendStableTimer = undefined;
	if (isQuitting || backend || backendRestartTimer) return;
	if (backendRestartAttempts >= MAX_BACKEND_RESTART_ATTEMPTS) {
		backendStarting = false;
		backendRetryAt = 0;
		sendToRenderer("backend:status", {
			ready: false,
			error: `Pi backend stopped after ${MAX_BACKEND_RESTART_ATTEMPTS} restart attempts. ${reason}`,
		});
		return;
	}
	const delay = 1000 * 2 ** backendRestartAttempts;
	backendRestartAttempts += 1;
	backendStarting = true;
	backendRetryAt = Date.now() + delay;
	sendToRenderer("backend:status", {
		ready: false,
		starting: true,
		restarting: true,
		retryInMs: delay,
		error: reason,
	});
	backendRestartTimer = setTimeout(() => {
		backendRestartTimer = undefined;
		backendRetryAt = 0;
		startBackend();
	}, delay);
}

function startBackend() {
	if (backend) {
		return;
	}

	const backendPath = getBackendPath();
	if (!existsSync(backendPath)) {
		backendReady = false;
		sendToRenderer("backend:status", {
			ready: false,
			error: `Pi backend not found: ${backendPath}`,
		});
		return;
	}

	backendBuffer = "";
	backendBufferBytes = 0;
	backendRetryAt = 0;
	const child = spawn(backendPath, [], {
		cwd: backendCwd,
		env: {
			...process.env,
			PI_DESKTOP: "1",
		},
		stdio: ["pipe", "pipe", "pipe"],
		windowsHide: true,
	});
	backend = child;
	sessionMutationQueue.invalidate();
	backendReady = false;
	backendStarting = true;
	backendStderr = "";
	sendToRenderer("backend:status", { ready: false, starting: true, backendPath, cwd: backendCwd });

	child.stdout.on("data", (chunk) => {
		if (backend !== child) return;
		handleBackendStdout(chunk);
	});
	child.stderr.on("data", (chunk) => {
		if (backend !== child) return;
		const message = chunk.toString("utf8").slice(-16 * 1024);
		backendStderr = `${backendStderr}${message}`.slice(-MAX_BACKEND_STDERR_BYTES);
		sendToRenderer("backend:log", { level: "error", message });
	});
	child.on("exit", (code, signal) => {
		if (backend !== child) {
			return;
		}
		sessionMutationQueue.invalidate();
		backendReady = false;
		backendStarting = false;
		backend = undefined;
		const message = `Pi backend exited code=${code} signal=${signal}. ${backendStderr}`;
		rejectPendingRequests(new Error(message));
		scheduleBackendRestart(message);
	});
	child.on("error", (error) => {
		if (backend !== child) {
			return;
		}
		sessionMutationQueue.invalidate();
		backend = undefined;
		backendReady = false;
		backendStarting = false;
		rejectPendingRequests(error);
		scheduleBackendRestart(error.message);
	});

	void requestBackend({ type: "get_state" }, { allowStarting: true, timeoutMs: 15000 })
		.then(() => {
			if (backend !== child) return;
			backendStarting = false;
			backendReady = true;
			sendToRenderer("backend:status", { ready: true, backendPath, cwd: backendCwd });
			clearTimeout(backendStableTimer);
			backendStableTimer = setTimeout(() => {
				if (backend === child && backendReady) backendRestartAttempts = 0;
			}, 30000);
		})
		.catch((error) => {
			if (backend !== child) return;
			backendStarting = false;
			backendReady = false;
			sendToRenderer("backend:status", { ready: false, error: `Pi backend failed to initialize: ${error.message}` });
			child.kill();
		});
}

function stopBackend() {
	clearBackendRestartTimers();
	backendRestartAttempts = 0;
	sessionMutationQueue.invalidate();
	if (!backend) {
		return;
	}
	const child = backend;
	backend = undefined;
	backendReady = false;
	backendStarting = false;
	rejectPendingRequests(new Error("Pi backend stopped"));
	child.kill();
}

function requestBackend(command, { allowStarting = false, timeoutMs = 30000 } = {}) {
	if ((!backendReady && !(allowStarting && backendStarting)) || !backend?.stdin?.writable) {
		return Promise.reject(new Error(backendStarting ? "Pi backend is starting" : "Pi backend is not running"));
	}

	const id = `desktop_${++requestCounter}`;
	const payload = { ...command, id };

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			pendingRequests.delete(id);
			reject(new Error(`Timed out waiting for ${command.type}`));
		}, timeoutMs);

		pendingRequests.set(id, { resolve, reject, timeout });
		backend.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
			if (!error) {
				return;
			}
			clearTimeout(timeout);
			pendingRequests.delete(id);
			reject(error);
		});
	});
}

function sendBackend(command) {
	if (!backendReady || !backend?.stdin?.writable) {
		return Promise.reject(new Error("Pi backend is not running"));
	}
	return new Promise((resolve, reject) => {
		backend.stdin.write(`${JSON.stringify(command)}\n`, (error) => {
			if (error) {
				reject(error);
			} else {
				resolve();
			}
		});
	});
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
		startBackend();
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

function getRequestTimeoutMs(command) {
	if (command?.type === "prompt") return PROMPT_REQUEST_TIMEOUT_MS;
	return LONG_REQUEST_COMMAND_TYPES.has(command?.type) ? LONG_REQUEST_COMMAND_TIMEOUT_MS : undefined;
}

function serializeSessionMutation(operation) {
	return sessionMutationQueue.serialize(operation);
}

async function getKnownSessionFile(sessionPath) {
	const [firstPageResponse, stateResponse] = await Promise.all([
		requestBackend({ type: "get_sessions", all: true, offset: 0, limit: 200 }),
		requestBackend({ type: "get_state" }),
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
		const nextPageResponse = await requestBackend({
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

ipcMain.handle("backend:request", async (_event, command) => {
	const execute = async () => {
		const timeoutMs = getRequestTimeoutMs(command);
		const response = await requestBackend(command, timeoutMs === undefined ? {} : { timeoutMs });
		if (!response.success) {
			throw new Error(response.error || `Command failed: ${response.command}`);
		}
		const data = response.data ?? null;
		if (
			(command?.type === "new_session" || command?.type === "switch_session") &&
			data &&
			typeof data === "object" &&
			typeof data.cwd === "string"
		) {
			syncBackendCwd(data.cwd);
		}
		return data;
	};
	return SESSION_MUTATION_COMMAND_TYPES.has(command?.type) ? serializeSessionMutation(execute) : execute();
});

ipcMain.handle("backend:send", async (_event, command) => {
	await sendBackend(command);
});

ipcMain.handle("backend:get-status", () => ({
	ready: backendReady,
	starting: backendStarting,
	restarting: Boolean(backendRestartTimer),
	retryInMs: backendRetryAt ? Math.max(0, backendRetryAt - Date.now()) : 0,
	restartAttempts: backendRestartAttempts,
	backendPath: getBackendPath(),
	cwd: backendCwd,
}));

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
			ready: backendReady,
			starting: backendStarting,
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
	const result = await dialog.showSaveDialog(mainWindow, {
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
	const result = await dialog.showSaveDialog(mainWindow, {
		title: "Export Pi Studio model configuration",
		defaultPath: join(app.getPath("documents"), "pi-studio-models.json"),
		filters: [{ name: "JSON", extensions: ["json"] }],
	});
	if (result.canceled || !result.filePath) return { saved: false };
	await writeFile(result.filePath, contents, { encoding: "utf8", mode: 0o600 });
	return { saved: true, path: result.filePath };
});

ipcMain.handle("model-config:open", async () => {
	const result = await dialog.showOpenDialog(mainWindow, {
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
	stopBackend();
	startBackend();
});

ipcMain.handle("workspace:choose", async () => {
	const result = await dialog.showOpenDialog(mainWindow, {
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
	stopBackend();
	startBackend();
	return { cwd: backendCwd, changed: true };
});

ipcMain.handle("workspace:get", async () => ({ cwd: backendCwd, taskCwd: getTaskWorkspacePath() }));

ipcMain.handle("workspace:get-git-status", async () => {
	const cwd = backendCwd;
	return { cwd, ...(await getGitWorkspaceStatus(cwd)) };
});

ipcMain.handle("workspace:list-files", async (_event, query) => ({
	files: listWorkspaceFiles(backendCwd, String(query ?? "")),
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

app.on("before-quit", () => {
	isQuitting = true;
	stopBackend();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});
