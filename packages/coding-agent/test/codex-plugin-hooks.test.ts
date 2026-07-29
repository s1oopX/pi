import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createModelRegistry } from "./model-runtime-test-utils.ts";

interface HookRecord {
	payload: Record<string, unknown>;
	pluginData: string;
	pluginRoot: string;
	codexPluginRoot: string;
}

describe("Codex plugin hooks", () => {
	let tempDir: string;
	let agentDir: string;
	let cwd: string;
	let pluginDir: string;
	let hooksPath: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `codex-hooks-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		cwd = join(tempDir, "project");
		pluginDir = join(tempDir, "plugin");
		hooksPath = join(pluginDir, "hooks", "hooks.json");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(cwd, { recursive: true });
		mkdirSync(join(pluginDir, ".codex-plugin"), { recursive: true });
		mkdirSync(join(pluginDir, "hooks"), { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("loads trusted project hooks and bridges lifecycle context", async () => {
		writeFileSync(
			join(pluginDir, ".codex-plugin", "plugin.json"),
			JSON.stringify({ name: "test-hooks", version: "1.0.0", hooks: "./hooks/hooks.json" }),
		);
		writeFileSync(
			hooksPath,
			JSON.stringify({
				hooks: {
					SessionStart: [
						{
							matcher: "startup|resume|clear|compact",
							hooks: [
								{
									type: "command",
									command: 'node "$CLAUDE_PLUGIN_ROOT/hooks/test-hook.cjs"',
									commandWindows: 'node "$env:CLAUDE_PLUGIN_ROOT\\hooks\\test-hook.cjs"',
									timeout: 5,
								},
							],
						},
					],
					UserPromptSubmit: [
						{
							hooks: [
								{
									type: "command",
									command: 'node "$CLAUDE_PLUGIN_ROOT/hooks/test-hook.cjs"',
									commandWindows: 'node "$env:CLAUDE_PLUGIN_ROOT\\hooks\\test-hook.cjs"',
								},
							],
						},
					],
					PostToolUse: [
						{
							matcher: "Write|Edit",
							hooks: [
								{
									type: "command",
									command: 'node "$CLAUDE_PLUGIN_ROOT/hooks/test-hook.cjs"',
									commandWindows: 'node "$env:CLAUDE_PLUGIN_ROOT\\hooks\\test-hook.cjs"',
								},
							],
						},
					],
				},
			}),
		);
		writeFileSync(
			join(pluginDir, "hooks", "test-hook.cjs"),
			`const fs = require("node:fs");
const path = require("node:path");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const payload = JSON.parse(input.replace(/^\\uFEFF/, ""));
  const record = {
    payload,
    pluginData: process.env.PLUGIN_DATA,
    pluginRoot: process.env.CLAUDE_PLUGIN_ROOT,
    codexPluginRoot: process.env.CODEX_PLUGIN_ROOT,
  };
  fs.appendFileSync(path.join(process.env.PLUGIN_DATA, "events.jsonl"), JSON.stringify(record) + "\\n");
  if (payload.hook_event_name === "SessionStart") {
    process.stdout.write(JSON.stringify({
      systemMessage: "session",
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "session:" + payload.source },
    }));
  } else if (payload.hook_event_name === "UserPromptSubmit") {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "prompt:" + payload.prompt },
    }));
  } else {
    process.stdout.write("post:" + payload.tool_name);
  }
});
`,
		);

		const settingsManager = SettingsManager.inMemory();
		settingsManager.setProjectPackages([pluginDir]);
		await settingsManager.reload();
		const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
		await loader.reload({
			resolveProjectTrust: async ({ extensionsResult }) => {
				expect(extensionsResult.extensions.some((extension) => extension.path === hooksPath)).toBe(false);
				return true;
			},
		});

		const extensionsResult = loader.getExtensions();
		expect(extensionsResult.errors).toEqual([]);
		expect(extensionsResult.extensions.some((extension) => extension.path === hooksPath)).toBe(true);

		const modelRegistry = await createModelRegistry(AuthStorage.create(join(tempDir, "auth.json")));
		const runner = new ExtensionRunner(
			extensionsResult.extensions,
			extensionsResult.runtime,
			cwd,
			SessionManager.inMemory(),
			modelRegistry,
		);
		const errors: string[] = [];
		runner.onError((error) => errors.push(error.error));

		await runner.emit({ type: "session_start", reason: "startup" });
		expect(await runner.emitBeforeAgentStart("first", undefined, "base", { cwd })).toEqual({
			messages: undefined,
			systemPrompt: "base\n\nsession:startup",
		});

		expect(await runner.emitInput("hello", undefined, "interactive")).toEqual({ action: "continue" });
		expect(await runner.emitBeforeAgentStart("hello", undefined, "base", { cwd })).toEqual({
			messages: undefined,
			systemPrompt: "base\n\nsession:startup\n\nprompt:hello",
		});
		expect(await runner.emitBeforeAgentStart("next", undefined, "base", { cwd })).toEqual({
			messages: undefined,
			systemPrompt: "base\n\nsession:startup",
		});

		const writeResult = await runner.emitToolResult({
			type: "tool_result",
			toolName: "write",
			toolCallId: "write-1",
			input: { path: "file.ts" },
			content: [{ type: "text", text: "written" }],
			details: undefined,
			isError: false,
		});
		expect(writeResult?.content).toEqual([
			{ type: "text", text: "written" },
			{ type: "text", text: "post:write" },
		]);
		expect(
			await runner.emitToolResult({
				type: "tool_result",
				toolName: "read",
				toolCallId: "read-1",
				input: { path: "file.ts" },
				content: [{ type: "text", text: "read" }],
				details: undefined,
				isError: false,
			}),
		).toBeUndefined();

		const pluginDataRoot = join(agentDir, "plugin-data");
		const dataDirs = readdirSync(pluginDataRoot);
		expect(dataDirs).toHaveLength(1);
		const pluginData = join(pluginDataRoot, dataDirs[0]!);
		const records = readFileSync(join(pluginData, "events.jsonl"), "utf-8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as HookRecord);
		expect(records).toHaveLength(3);
		expect(records.map((record) => record.payload.hook_event_name)).toEqual([
			"SessionStart",
			"UserPromptSubmit",
			"PostToolUse",
		]);
		expect(records[1]?.payload.prompt).toBe("hello");
		expect(records[2]?.payload.tool_name).toBe("write");
		for (const record of records) {
			expect(record.pluginData).toBe(pluginData);
			expect(record.pluginRoot).toBe(pluginDir);
			expect(record.codexPluginRoot).toBe(pluginDir);
			expect(record.payload.cwd).toBe(cwd);
		}
		expect(errors).toEqual([]);
	});
});
