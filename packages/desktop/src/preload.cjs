const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("piDesktop", {
	request(command) {
		return ipcRenderer.invoke("backend:request", command);
	},
	send(command) {
		return ipcRenderer.invoke("backend:send", command);
	},
	getBackendStatus() {
		return ipcRenderer.invoke("backend:get-status");
	},
	getPendingExtensionUIRequests() {
		return ipcRenderer.invoke("backend:get-pending-extension-ui-requests");
	},
	restartBackend() {
		return ipcRenderer.invoke("backend:restart");
	},
	chooseWorkspace() {
		return ipcRenderer.invoke("workspace:choose");
	},
	openWorkspace(cwd) {
		return ipcRenderer.invoke("workspace:open", cwd);
	},
	getWorkspace() {
		return ipcRenderer.invoke("workspace:get");
	},
	getWorkspaceGitStatus() {
		return ipcRenderer.invoke("workspace:get-git-status");
	},
	getGitChanges() {
		return ipcRenderer.invoke("git:changes");
	},
	commitAllGitChanges(message) {
		return ipcRenderer.invoke("git:commit-all", message);
	},
	getGitBranches() {
		return ipcRenderer.invoke("git:branches");
	},
	pushGitBranch() {
		return ipcRenderer.invoke("git:push");
	},
	switchGitBranch(name, options) {
		return ipcRenderer.invoke("git:switch-branch", name, options);
	},
	getGitPrContext() {
		return ipcRenderer.invoke("git:pr-context");
	},
	createGitPullRequest(params) {
		return ipcRenderer.invoke("git:create-pr", params);
	},
	listWorkspaceFiles(query) {
		return ipcRenderer.invoke("workspace:list-files", query);
	},
	openWorkspaceLocation(cwd) {
		return ipcRenderer.invoke("workspace:reveal", cwd);
	},
	revealWorkspacePath(targetPath) {
		return ipcRenderer.invoke("workspace:reveal-path", targetPath);
	},
	revealSessionFile(sessionPath) {
		return ipcRenderer.invoke("session:reveal", sessionPath);
	},
	trashSessionFile(sessionPath) {
		return ipcRenderer.invoke("session:trash", sessionPath);
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
