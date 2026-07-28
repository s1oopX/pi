const { contextBridge, ipcRenderer, webUtils } = require("electron");

// Pure pass-through bridge: every argument is forwarded verbatim and
// validated on the main-process side, so parameters are typed `unknown`
// (and `string`/functions where the renderer contract is that specific).

/** @typedef {(payload: any) => void} PayloadListener */

/**
 * @param {string} channel
 * @param {PayloadListener} listener
 */
function subscribe(channel, listener) {
	const handler = (/** @type {unknown} */ _event, /** @type {any} */ payload) => listener(payload);
	ipcRenderer.on(channel, handler);
	return () => ipcRenderer.off(channel, handler);
}

contextBridge.exposeInMainWorld("piDesktop", {
	request(/** @type {unknown} */ command, /** @type {string | undefined} */ taskId) {
		return ipcRenderer.invoke("backend:request", command, taskId);
	},
	send(/** @type {unknown} */ command, /** @type {string | undefined} */ taskId) {
		return ipcRenderer.invoke("backend:send", command, taskId);
	},
	getBackendStatus(/** @type {string | undefined} */ taskId) {
		return ipcRenderer.invoke("backend:get-status", taskId);
	},
	getPendingExtensionUIRequests(/** @type {string | undefined} */ taskId) {
		return ipcRenderer.invoke("backend:get-pending-extension-ui-requests", taskId);
	},
	createTask(/** @type {unknown} */ cwd) {
		return ipcRenderer.invoke("task:create", cwd);
	},
	listTasks() {
		return ipcRenderer.invoke("task:list");
	},
	stopTask(/** @type {unknown} */ taskId) {
		return ipcRenderer.invoke("task:stop", taskId);
	},
	notifyActiveTask(/** @type {unknown} */ taskId) {
		ipcRenderer.send("task:activate", taskId);
	},
	getTaskSettings() {
		return ipcRenderer.invoke("task:get-settings");
	},
	configureTasks(/** @type {unknown} */ settings) {
		return ipcRenderer.invoke("task:configure", settings);
	},
	listWorktreeLeftovers() {
		return ipcRenderer.invoke("worktrees:list-leftovers");
	},
	deleteWorktreeLeftover(/** @type {unknown} */ targetPath) {
		return ipcRenderer.invoke("worktrees:delete", targetPath);
	},
	onTaskChanged(/** @type {PayloadListener} */ listener) {
		return subscribe("task:changed", listener);
	},
	listAutomations() {
		return ipcRenderer.invoke("automation:list");
	},
	createAutomation(/** @type {unknown} */ input, /** @type {string | undefined} */ taskId) {
		return ipcRenderer.invoke("automation:create", input, taskId);
	},
	updateAutomation(/** @type {unknown} */ id, /** @type {unknown} */ input) {
		return ipcRenderer.invoke("automation:update", id, input);
	},
	setAutomationStatus(/** @type {unknown} */ id, /** @type {unknown} */ status) {
		return ipcRenderer.invoke("automation:set-status", id, status);
	},
	deleteAutomation(/** @type {unknown} */ id) {
		return ipcRenderer.invoke("automation:delete", id);
	},
	runAutomationNow(/** @type {unknown} */ id) {
		return ipcRenderer.invoke("automation:run-now", id);
	},
	updateAutomationRun(/** @type {unknown} */ automationId, /** @type {unknown} */ runId, /** @type {unknown} */ action) {
		return ipcRenderer.invoke("automation:update-run", automationId, runId, action);
	},
	openAutomationRun(/** @type {unknown} */ automationId, /** @type {unknown} */ runId) {
		return ipcRenderer.invoke("automation:open-run", automationId, runId);
	},
	onAutomationsChanged(/** @type {PayloadListener} */ listener) {
		return subscribe("automation:changed", listener);
	},
	restartBackend() {
		return ipcRenderer.invoke("backend:restart");
	},
	chooseWorkspace() {
		return ipcRenderer.invoke("workspace:choose");
	},
	pickTaskFolder() {
		return ipcRenderer.invoke("dialog:pick-folder");
	},
	openWorkspace(/** @type {unknown} */ cwd) {
		return ipcRenderer.invoke("workspace:open", cwd);
	},
	getWorkspace() {
		return ipcRenderer.invoke("workspace:get");
	},
	getWorkspaceGitStatus(/** @type {string | undefined} */ taskId) {
		return ipcRenderer.invoke("workspace:get-git-status", taskId);
	},
	getGitChanges(/** @type {string | undefined} */ taskId) {
		return ipcRenderer.invoke("git:changes", taskId);
	},
	commitAllGitChanges(/** @type {unknown} */ message, /** @type {string | undefined} */ taskId) {
		return ipcRenderer.invoke("git:commit-all", message, taskId);
	},
	getGitFileDiff(/** @type {unknown} */ filePath, /** @type {string | undefined} */ taskId) {
		return ipcRenderer.invoke("git:file-diff", filePath, taskId);
	},
	applyGitHunk(/** @type {unknown} */ params, /** @type {string | undefined} */ taskId) {
		return ipcRenderer.invoke("git:apply-hunk", params, taskId);
	},
	restoreGitFile(/** @type {unknown} */ filePath, /** @type {string | undefined} */ taskId) {
		return ipcRenderer.invoke("git:restore-file", filePath, taskId);
	},
	getGitBranches(/** @type {string | undefined} */ taskId) {
		return ipcRenderer.invoke("git:branches", taskId);
	},
	pushGitBranch(/** @type {string | undefined} */ taskId) {
		return ipcRenderer.invoke("git:push", taskId);
	},
	switchGitBranch(
		/** @type {unknown} */ name,
		/** @type {unknown} */ options,
		/** @type {string | undefined} */ taskId,
	) {
		return ipcRenderer.invoke("git:switch-branch", name, options, taskId);
	},
	getGitPrContext(/** @type {string | undefined} */ taskId) {
		return ipcRenderer.invoke("git:pr-context", taskId);
	},
	getGitPrReview(/** @type {string | undefined} */ taskId) {
		return ipcRenderer.invoke("git:pr-review", taskId);
	},
	createGitPullRequest(/** @type {unknown} */ params, /** @type {string | undefined} */ taskId) {
		return ipcRenderer.invoke("git:create-pr", params, taskId);
	},
	listWorkspaceFiles(/** @type {unknown} */ query, /** @type {string | undefined} */ taskId) {
		return ipcRenderer.invoke("workspace:list-files", query, taskId);
	},
	openWorkspaceLocation(/** @type {unknown} */ cwd) {
		return ipcRenderer.invoke("workspace:reveal", cwd);
	},
	revealWorkspacePath(/** @type {unknown} */ targetPath, /** @type {string | undefined} */ taskId) {
		return ipcRenderer.invoke("workspace:reveal-path", targetPath, taskId);
	},
	openWorkspacePath(/** @type {unknown} */ targetPath, /** @type {string | undefined} */ taskId) {
		return ipcRenderer.invoke("workspace:open-path", targetPath, taskId);
	},
	readWorkspaceFile(/** @type {unknown} */ targetPath, /** @type {string | undefined} */ taskId) {
		return ipcRenderer.invoke("workspace:read-file", targetPath, taskId);
	},
	revealSessionFile(/** @type {unknown} */ sessionPath) {
		return ipcRenderer.invoke("session:reveal", sessionPath);
	},
	trashSessionFile(/** @type {unknown} */ sessionPath) {
		return ipcRenderer.invoke("session:trash", sessionPath);
	},
	exportSessionFile(/** @type {unknown} */ sessionPath) {
		return ipcRenderer.invoke("session:export", sessionPath);
	},
	importSessionFile() {
		return ipcRenderer.invoke("session:import");
	},
	getDroppedFilePath(/** @type {File} */ file) {
		// Sandbox-safe absolute path for an OS drag-drop (File.path is gone).
		try {
			return webUtils.getPathForFile(file);
		} catch {
			return null;
		}
	},
	openExternal(/** @type {unknown} */ url) {
		return ipcRenderer.invoke("backend:open-external", url);
	},
	fetchProviderModels(/** @type {unknown} */ params) {
		return ipcRenderer.invoke("provider:fetch-models", params);
	},
	writeClipboardText(/** @type {unknown} */ text) {
		return ipcRenderer.invoke("clipboard:write-text", text);
	},
	getAppInfo() {
		return ipcRenderer.invoke("app:get-info");
	},
	getChangelog() {
		return ipcRenderer.invoke("app:get-changelog");
	},
	checkForUpdates() {
		return ipcRenderer.invoke("app:check-for-updates");
	},
	saveDiagnostics(/** @type {unknown} */ diagnostics) {
		return ipcRenderer.invoke("diagnostics:save", diagnostics);
	},
	openLogsFolder() {
		return ipcRenderer.invoke("logs:reveal");
	},
	saveModelBackup(/** @type {unknown} */ backup) {
		return ipcRenderer.invoke("model-config:save", backup);
	},
	openModelBackup() {
		return ipcRenderer.invoke("model-config:open");
	},
	createProject(/** @type {unknown} */ args) {
		return ipcRenderer.invoke("project:create", args);
	},
	getMirrorSources() {
		return ipcRenderer.invoke("mirror:get-status");
	},
	setMirrorSource(/** @type {unknown} */ args) {
		return ipcRenderer.invoke("mirror:set-source", args);
	},
	onEvent(/** @type {PayloadListener} */ listener) {
		return subscribe("backend:event", listener);
	},
	onStatus(/** @type {PayloadListener} */ listener) {
		return subscribe("backend:status", listener);
	},
	onLog(/** @type {PayloadListener} */ listener) {
		return subscribe("backend:log", listener);
	},
});
