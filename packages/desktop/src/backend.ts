#!/usr/bin/env node

import { join } from "node:path";
import { APP_NAME, getAgentDir } from "../../coding-agent/src/config.ts";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionRuntime,
} from "../../coding-agent/src/core/agent-session-runtime.ts";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "../../coding-agent/src/core/agent-session-services.ts";
import { AuthStorage } from "../../coding-agent/src/core/auth-storage.ts";
import { applyHttpProxySettings, configureHttpDispatcher } from "../../coding-agent/src/core/http-dispatcher.ts";
import { ModelRegistry } from "../../coding-agent/src/core/model-registry.ts";
import { SessionManager } from "../../coding-agent/src/core/session-manager.ts";
import { SettingsManager } from "../../coding-agent/src/core/settings-manager.ts";
import { runRpcMode } from "../../coding-agent/src/modes/rpc/rpc-mode.ts";

process.title = `${APP_NAME}-studio-rpc`;
process.env.PI_CODING_AGENT = "true";
process.emitWarning = (() => {}) as typeof process.emitWarning;

configureHttpDispatcher();

const initialCwd = process.cwd();
const agentDir = getAgentDir();
const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
const startupSettings = SettingsManager.create(initialCwd, agentDir);

const createRuntime: CreateAgentSessionRuntimeFactory = async ({
	cwd,
	agentDir: runtimeAgentDir,
	sessionManager,
	sessionStartEvent,
}) => {
	const settingsManager = SettingsManager.create(cwd, runtimeAgentDir);
	const modelRegistry = ModelRegistry.customOnly(authStorage, join(runtimeAgentDir, "models.json"));
	const services = await createAgentSessionServices({
		cwd,
		agentDir: runtimeAgentDir,
		authStorage,
		settingsManager,
		modelRegistry,
	});
	const created = await createAgentSessionFromServices({
		services,
		sessionManager,
		sessionStartEvent,
	});
	return {
		...created,
		services,
		diagnostics: services.diagnostics,
	};
};

const sessionManager = SessionManager.create(initialCwd, startupSettings.getSessionDir());
const runtime = await createAgentSessionRuntime(createRuntime, {
	cwd: initialCwd,
	agentDir,
	sessionManager,
});

applyHttpProxySettings(runtime.services.settingsManager.getGlobalSettings().httpProxy);
configureHttpDispatcher(runtime.services.settingsManager.getHttpIdleTimeoutMs());
await runRpcMode(runtime);
