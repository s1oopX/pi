import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const backendPath = join(import.meta.dirname, "../../coding-agent/dist/pi-studio-backend.exe");

test("Studio backend returns only models from the user models.json", { skip: !existsSync(backendPath) }, async (t) => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-studio-backend-"));
	writeFileSync(
		join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				"self-hosted": {
					baseUrl: "http://127.0.0.1:11434/v1",
					api: "openai-completions",
					models: [{ id: "only-custom-model" }],
				},
			},
		}),
	);
	writeFileSync(
		join(agentDir, "auth.json"),
		JSON.stringify({ "self-hosted": { type: "api_key", key: "local-test-key" } }),
	);

	const child = spawn(backendPath, [], {
		cwd: agentDir,
		env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
		stdio: ["pipe", "pipe", "pipe"],
		windowsHide: true,
	});
	let stderr = "";
	child.stderr.on("data", (chunk) => {
		stderr += chunk.toString("utf8");
	});

	let buffer = "";
	const pending = new Map();
	child.stdout.on("data", (chunk) => {
		buffer += chunk.toString("utf8");
		let newline = buffer.indexOf("\n");
		while (newline !== -1) {
			const line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			if (line.trim()) {
				const message = JSON.parse(line);
				const resolve = pending.get(message.id);
				if (resolve) {
					pending.delete(message.id);
					resolve(message);
				}
			}
			newline = buffer.indexOf("\n");
		}
	});

	let requestId = 0;
	const request = (type) =>
		new Promise((resolve, reject) => {
			const id = `test_${++requestId}`;
			const timeout = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`Timed out waiting for ${type}. ${stderr}`));
			}, 15000);
			pending.set(id, (message) => {
				clearTimeout(timeout);
				resolve(message);
			});
			child.stdin.write(`${JSON.stringify({ id, type })}\n`);
		});

	t.after(async () => {
		if (child.exitCode === null) {
			child.kill();
			await once(child, "exit");
		}
		rmSync(agentDir, { recursive: true, force: true });
	});

	const state = await request("get_state");
	assert.equal(state.success, true, stderr);
	const models = await request("get_available_models");
	assert.equal(models.success, true, stderr);
	assert.deepEqual(
		models.data.models.map(({ provider, id }) => ({ provider, id })),
		[{ provider: "self-hosted", id: "only-custom-model" }],
	);
	const custom = await request("get_custom_models");
	assert.deepEqual(Object.keys(custom.data.providers), ["self-hosted"]);
});
