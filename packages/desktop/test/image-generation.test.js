import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { AuthStorage } from "../../coding-agent/src/core/auth-storage.ts";
import { SettingsManager } from "../../coding-agent/src/core/settings-manager.ts";
import { imageGenerationExtension } from "../src/image-generation.ts";

const ONE_PIXEL_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=";

describe("image generation", () => {
	let baseUrl;
	let requests;
	let server;

	before(async () => {
		requests = [];
		server = createServer((request, response) => {
			let body = "";
			request.setEncoding("utf8");
			request.on("data", (chunk) => {
				body += chunk;
			});
			request.on("end", () => {
				const parsed = JSON.parse(body);
				requests.push(parsed);
				const mimeType = parsed.messages[0].content[0].text === "Return HTML" ? "text/html" : "image/png";
				const imageData = mimeType === "image/png" ? ONE_PIXEL_PNG : Buffer.from("<html></html>").toString("base64");
				response.writeHead(200, { "content-type": "application/json" });
				response.end(
					JSON.stringify({
						id: "image-1",
						object: "chat.completion",
						created: 1,
						model: "image-model",
						choices: [
							{
								index: 0,
								finish_reason: "stop",
								message: {
									role: "assistant",
									content: "Created from the reference.",
									images: [{ image_url: { url: `data:${mimeType};base64,${imageData}` } }],
								},
							},
						],
					}),
				);
			});
		});
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		baseUrl = `http://127.0.0.1:${address.port}/v1`;
	});

	after(async () => {
		await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	});

	it("registers only when enabled, sends references, and writes a contained artifact", async (t) => {
		let disabledTool;
		imageGenerationExtension(
			{ registerTool(tool) { disabledTool = tool; } },
			SettingsManager.inMemory(),
			AuthStorage.inMemory(),
		);
		assert.equal(disabledTool, undefined);

		const cwd = mkdtempSync(join(tmpdir(), "pi-image-generation-"));
		t.after(() => rmSync(cwd, { recursive: true, force: true }));
		writeFileSync(join(cwd, "reference.png"), Buffer.from(ONE_PIXEL_PNG, "base64"));
		const settings = SettingsManager.inMemory({
			imageGeneration: { enabled: true, provider: "image-host", model: "image-model", baseUrl },
		});
		const auth = AuthStorage.inMemory({ "image-host": { type: "api_key", key: "test-key" } });
		let tool;
		imageGenerationExtension({ registerTool(value) { tool = value; } }, settings, auth);
		assert.ok(tool);

		const requestCount = requests.length;
		await assert.rejects(
			tool.execute("call-1", { prompt: "escape", outputPath: "../escape.png" }, undefined, undefined, { cwd }),
			/outside|inside the workspace/,
		);
		const outside = mkdtempSync(join(tmpdir(), "pi-image-generation-outside-"));
		t.after(() => rmSync(outside, { recursive: true, force: true }));
		symlinkSync(outside, join(cwd, "outside-link"), process.platform === "win32" ? "junction" : "dir");
		await assert.rejects(
			tool.execute(
				"call-symlink",
				{ prompt: "escape", outputPath: "outside-link/escape.png" },
				undefined,
				undefined,
				{ cwd },
			),
			/resolves outside the workspace/,
		);
		assert.equal(requests.length, requestCount);
		await assert.rejects(
			tool.execute(
				"call-invalid-image",
				{ prompt: "Return HTML", outputPath: "generated/invalid.png" },
				undefined,
				undefined,
				{ cwd },
			),
			/Unsupported generated image type/,
		);
		assert.equal(existsSync(join(cwd, "generated", "invalid.png")), false);

		const result = await tool.execute(
			"call-2",
			{ prompt: "Make it blue", references: ["reference.png"], outputPath: "generated/result.png" },
			undefined,
			undefined,
			{ cwd },
		);
		assert.deepEqual(readFileSync(join(cwd, "generated", "result.png")), Buffer.from(ONE_PIXEL_PNG, "base64"));
		assert.equal(result.details.path, "generated/result.png");
		assert.equal(result.content.some((item) => item.type === "image"), true);
		assert.equal(requests.at(-1).messages[0].content[0].text, "Make it blue");
		assert.match(requests.at(-1).messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
	});
});
