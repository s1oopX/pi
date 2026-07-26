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
import { ModelRuntime } from "../../coding-agent/src/core/model-runtime.ts";
import { SessionManager } from "../../coding-agent/src/core/session-manager.ts";
import { SettingsManager } from "../../coding-agent/src/core/settings-manager.ts";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "../../coding-agent/src/core/trust-manager.ts";
import { runRpcMode } from "../../coding-agent/src/modes/rpc/rpc-mode.ts";
import { toolApprovalExtension } from "./tool-approval.ts";
import { resolveWorktreeSourceRoot } from "./worktree-trust.js";

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
	// Catalog-free runtime: only models.json models, no network catalog refresh
	// (allowModelNetwork defaults to false). The bundled pi-ai ships no built-in
	// provider catalogs; scripts/build-backend.mjs verifies that.
	const modelRuntime = await ModelRuntime.create({
		credentials: authStorage,
		modelsPath: join(runtimeAgentDir, "models.json"),
	});
	// Project trust: pi trusts projects by default, which would auto-run a
	// folder's .pi extensions/settings on open. Studio flips that to safe —
	// folders with trust-requiring resources stay untrusted until the user
	// explicitly trusts them (persisted in <agentDir>/trust.json). The
	// set_project_trust RPC command updates the store and hot-reloads.
	// Trust follows the repository identity: a linked worktree inherits its
	// source repo's trusted decision (an explicit decision on the worktree
	// path itself always wins, either way).
	const trustStore = new ProjectTrustStore(runtimeAgentDir);
	const resolveTrust = () => {
		if (!hasTrustRequiringProjectResources(cwd)) return true;
		const own = trustStore.get(cwd);
		if (own !== null) return own === true;
		const sourceRoot = resolveWorktreeSourceRoot(cwd);
		return sourceRoot !== null && trustStore.get(sourceRoot) === true;
	};
	const services = await createAgentSessionServices({
		cwd,
		agentDir: runtimeAgentDir,
		settingsManager,
		modelRuntime,
		resourceLoaderOptions: {
			extensionFactories: [{ name: "tool-approval", factory: toolApprovalExtension }],
		},
		resourceLoaderReloadOptions: {
			resolveProjectTrust: async () => resolveTrust(),
		},
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
