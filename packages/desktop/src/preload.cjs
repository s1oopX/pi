const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("piDesktop", {
	request(command, taskId) {
		return ipcRenderer.invoke("backend:request", command, taskId);
	},
	send(command, taskId) {
		return ipcRenderer.invoke("backend:send", command, taskId);
	},
	getBackendStatus(taskId) {
		return ipcRenderer.invoke("backend:get-status", taskId);
	},
	getPendingExtensionUIRequests(taskId) {
		return ipcRenderer.invoke("backend:get-pending-extension-ui-requests", taskId);
	},
	createTask(cwd) {
		return ipcRenderer.invoke("task:create", cwd);
	},
	listTasks() {
		return ipcRenderer.invoke("task:list");
	},
	stopTask(taskId) {
		return ipcRenderer.invoke("task:stop", taskId);
	},
	notifyActiveTask(taskId) {
		ipcRenderer.send("task:activate", taskId);
	},
	getTaskSettings() {
		return ipcRenderer.invoke("task:get-settings");
	},
	configureTasks(settings) {
		return ipcRenderer.invoke("task:configure", settings);
	},
	onTaskChanged(listener) {
		const handler = (_event, payload) => listener(payload);
		ipcRenderer.on("task:changed", handler);
		return () => ipcRenderer.off("task:changed", handler);
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
	openWorkspace(cwd) {
		return ipcRenderer.invoke("workspace:open", cwd);
	},
	getWorkspace() {
		return ipcRenderer.invoke("workspace:get");
	},
	getWorkspaceGitStatus(taskId) {
		return ipcRenderer.invoke("workspace:get-git-status", taskId);
	},
	getGitChanges(taskId) {
		return ipcRenderer.invoke("git:changes", taskId);
	},
	commitAllGitChanges(message, taskId) {
		return ipcRenderer.invoke("git:commit-all", message, taskId);
	},
	getGitBranches(taskId) {
		return ipcRenderer.invoke("git:branches", taskId);
	},
	pushGitBranch(taskId) {
		return ipcRenderer.invoke("git:push", taskId);
	},
	switchGitBranch(name, options, taskId) {
		return ipcRenderer.invoke("git:switch-branch", name, options, taskId);
	},
	getGitPrContext(taskId) {
		return ipcRenderer.invoke("git:pr-context", taskId);
	},
	createGitPullRequest(params, taskId) {
		return ipcRenderer.invoke("git:create-pr", params, taskId);
	},
	listWorkspaceFiles(query, taskId) {
		return ipcRenderer.invoke("workspace:list-files", query, taskId);
	},
	openWorkspaceLocation(cwd) {
		return ipcRenderer.invoke("workspace:reveal", cwd);
	},
	revealWorkspacePath(targetPath, taskId) {
		return ipcRenderer.invoke("workspace:reveal-path", targetPath, taskId);
	},
	revealSessionFile(sessionPath) {
		return ipcRenderer.invoke("session:reveal", sessionPath);
	},
	trashSessionFile(sessionPath) {
		return ipcRenderer.invoke("session:trash", sessionPath);
	},
	exportSessionFile(sessionPath) {
		return ipcRenderer.invoke("session:export", sessionPath);
	},
	importSessionFile() {
		return ipcRenderer.invoke("session:import");
	},
	openExternal(url) {
		return ipcRenderer.invoke("backend:open-external", url);
	},
	fetchProviderModels(params) {
		return ipcRenderer.invoke("provider:fetch-models", params);
	},
	writeClipboardText(text) {
		return ipcRenderer.invoke("clipboard:write-text", text);
	},
	getAppInfo() {
		return ipcRenderer.invoke("app:get-info");
	},
	checkForUpdates() {
		return ipcRenderer.invoke("app:check-for-updates");
	},
	saveDiagnostics(diagnostics) {
		return ipcRenderer.invoke("diagnostics:save", diagnostics);
	},
	openLogsFolder() {
		return ipcRenderer.invoke("logs:reveal");
	},
	saveModelBackup(backup) {
		return ipcRenderer.invoke("model-config:save", backup);
	},
	openModelBackup() {
		return ipcRenderer.invoke("model-config:open");
	},
	onEvent(listener) {
		const handler = (_event, payload) => listener(payload);
		ipcRenderer.on("backend:event", handler);
		return () => ipcRenderer.off("backend:event", handler);
	},
	onStatus(listener) {
		const handler = (_event, payload) => listener(payload);
		ipcRenderer.on("backend:status", handler);
		return () => ipcRenderer.off("backend:status", handler);
	},
	onLog(listener) {
		const handler = (_event, payload) => listener(payload);
		ipcRenderer.on("backend:log", handler);
		return () => ipcRenderer.off("backend:log", handler);
	},
});
