import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getShellConfig } from "../utils/shell.ts";
import type {
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionFactory,
	InputEvent,
	SessionStartEvent,
	ToolResultEvent,
} from "./extensions/types.ts";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 10 * 60_000;

type SupportedCodexHookEvent = "SessionStart" | "UserPromptSubmit" | "PostToolUse";

interface CodexHookCommand {
	command: string;
	commandWindows?: string;
	timeoutMs: number;
}

interface CodexHookGroup {
	matcher?: RegExp;
	commands: CodexHookCommand[];
}

type CodexHookGroups = Record<SupportedCodexHookEvent, CodexHookGroup[]>;

export interface CodexPluginHookFactoryOptions {
	configPath: string;
	pluginRoot: string;
	agentDir: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTimeoutMs(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return DEFAULT_TIMEOUT_MS;
	}
	return Math.min(value * 1000, MAX_TIMEOUT_MS);
}

function parseCommand(value: unknown): CodexHookCommand | undefined {
	if (!isRecord(value) || value.type !== "command" || typeof value.command !== "string") {
		return undefined;
	}
	const command = value.command.trim();
	if (!command) return undefined;
	const commandWindows = typeof value.commandWindows === "string" ? value.commandWindows.trim() : undefined;
	return {
		command,
		commandWindows: commandWindows || undefined,
		timeoutMs: parseTimeoutMs(value.timeout),
	};
}

function parseGroups(value: unknown, configPath: string): CodexHookGroup[] {
	if (!Array.isArray(value)) return [];
	const groups: CodexHookGroup[] = [];
	for (const entry of value) {
		if (!isRecord(entry) || !Array.isArray(entry.hooks)) continue;
		const commands = entry.hooks.map(parseCommand).filter((command): command is CodexHookCommand => Boolean(command));
		if (commands.length === 0) continue;
		let matcher: RegExp | undefined;
		if (typeof entry.matcher === "string" && entry.matcher.trim()) {
			try {
				matcher = new RegExp(entry.matcher, "i");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(`Invalid Codex hook matcher in ${configPath}: ${message}`);
			}
		}
		groups.push({ matcher, commands });
	}
	return groups;
}

function readHookGroups(configPath: string): CodexHookGroups {
	const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as unknown;
	if (!isRecord(parsed) || !isRecord(parsed.hooks)) {
		throw new Error(`Invalid Codex hooks file: ${configPath}`);
	}
	return {
		SessionStart: parseGroups(parsed.hooks.SessionStart, configPath),
		UserPromptSubmit: parseGroups(parsed.hooks.UserPromptSubmit, configPath),
		PostToolUse: parseGroups(parsed.hooks.PostToolUse, configPath),
	};
}

export function getCodexPluginDataDir(agentDir: string, pluginRoot: string): string {
	const id = createHash("sha256").update(resolve(pluginRoot)).digest("hex").slice(0, 16);
	const dataDir = join(agentDir, "plugin-data", id);
	mkdirSync(dataDir, { recursive: true, mode: 0o700 });
	return dataDir;
}

function getHookContext(stdout: string): string | undefined {
	const trimmed = stdout.replace(/^\uFEFF/, "").trim();
	if (!trimmed) return undefined;
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		if (typeof parsed === "string") return parsed.trim() || undefined;
		if (!isRecord(parsed) || !isRecord(parsed.hookSpecificOutput)) return undefined;
		const context = parsed.hookSpecificOutput.additionalContext;
		return typeof context === "string" ? context.trim() || undefined : undefined;
	} catch {
		return trimmed;
	}
}

function getSessionStartSource(reason: SessionStartEvent["reason"]): string {
	if (reason === "new") return "clear";
	if (reason === "resume" || reason === "fork") return "resume";
	return "startup";
}

export function createCodexPluginHookFactory(options: CodexPluginHookFactoryOptions): ExtensionFactory {
	return (pi: ExtensionAPI) => {
		const groups = readHookGroups(options.configPath);
		const pluginDataDir = getCodexPluginDataDir(options.agentDir, options.pluginRoot);
		let sessionContexts: string[] = [];
		const pendingPromptContexts: string[][] = [];

		const run = async (
			eventName: SupportedCodexHookEvent,
			matchValue: string,
			payload: Record<string, unknown>,
			signal?: AbortSignal,
		): Promise<{ matched: boolean; contexts: string[] }> => {
			const contexts: string[] = [];
			let matched = false;
			for (const group of groups[eventName]) {
				if (group.matcher && !group.matcher.test(matchValue)) continue;
				matched = true;
				for (const hook of group.commands) {
					const usePowerShell = process.platform === "win32" && hook.commandWindows;
					const shell = usePowerShell
						? { shell: "powershell.exe", args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"] }
						: getShellConfig();
					if (shell.commandTransport === "stdin") {
						throw new Error("Codex hooks require a shell that accepts the command as an argument");
					}
					const result = await pi.exec(
						shell.shell,
						[...shell.args, usePowerShell ? hook.commandWindows! : hook.command],
						{
							cwd: options.pluginRoot,
							env: {
								CLAUDE_PLUGIN_ROOT: options.pluginRoot,
								CODEX_PLUGIN_ROOT: options.pluginRoot,
								PLUGIN_ROOT: options.pluginRoot,
								PLUGIN_DATA: pluginDataDir,
							},
							input: `${JSON.stringify(payload)}\n`,
							signal,
							timeout: hook.timeoutMs,
						},
					);
					if (result.killed) {
						throw new Error(`Codex ${eventName} hook timed out`);
					}
					if (result.code !== 0) {
						const details = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
						throw new Error(`Codex ${eventName} hook failed: ${details.slice(-4000)}`);
					}
					const context = getHookContext(result.stdout);
					if (context) contexts.push(context);
				}
			}
			return { matched, contexts };
		};

		pi.on("session_start", async (event, ctx) => {
			pendingPromptContexts.length = 0;
			const source = getSessionStartSource(event.reason);
			const result = await run(
				"SessionStart",
				source,
				{ cwd: ctx.cwd, hook_event_name: "SessionStart", source },
				ctx.signal,
			);
			sessionContexts = result.contexts;
		});

		pi.on("session_compact", async (_event, ctx) => {
			const result = await run(
				"SessionStart",
				"compact",
				{ cwd: ctx.cwd, hook_event_name: "SessionStart", source: "compact" },
				ctx.signal,
			);
			if (result.matched) sessionContexts = result.contexts;
		});

		pi.on("input", async (event: InputEvent, ctx) => {
			if (event.source === "extension") return;
			const result = await run(
				"UserPromptSubmit",
				event.text,
				{ cwd: ctx.cwd, hook_event_name: "UserPromptSubmit", prompt: event.text },
				ctx.signal,
			);
			pendingPromptContexts.push(result.contexts);
		});

		pi.on("before_agent_start", (event): BeforeAgentStartEventResult | undefined => {
			const contexts = [...sessionContexts, ...(pendingPromptContexts.shift() ?? [])];
			if (contexts.length === 0) return undefined;
			return { systemPrompt: `${event.systemPrompt}\n\n${contexts.join("\n\n")}` };
		});

		pi.on("tool_result", async (event: ToolResultEvent, ctx) => {
			if (event.isError) return;
			const result = await run(
				"PostToolUse",
				event.toolName,
				{
					cwd: ctx.cwd,
					hook_event_name: "PostToolUse",
					tool_input: event.input,
					tool_name: event.toolName,
					tool_response: { content: event.content, is_error: event.isError },
				},
				ctx.signal,
			);
			if (result.contexts.length === 0) return;
			return {
				content: [...event.content, { type: "text" as const, text: result.contexts.join("\n\n") }],
			};
		});
	};
}
