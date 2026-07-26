/**
 * Minimal OpenAI-compatible chat-completions server for desktop e2e tests.
 * Deterministic: every completion answers with the configured reply, streamed
 * as SSE when the client asks for streaming. No network beyond 127.0.0.1.
 */

import { createServer } from "node:http";

export function startFauxOpenAiServer({ reply = "Hello from faux." } = {}) {
	const requests = [];
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			if (req.method === "POST" && req.url && req.url.endsWith("/chat/completions")) {
				let parsed;
				try {
					parsed = JSON.parse(body);
				} catch {
					parsed = undefined;
				}
				requests.push({ url: req.url, body: parsed });
				respondChatCompletion(res, parsed, reply);
				return;
			}
			res.writeHead(404, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: { message: `Unexpected request: ${req.method} ${req.url}` } }));
		});
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			resolve({
				port,
				baseUrl: `http://127.0.0.1:${port}/v1`,
				requests,
				close: () => new Promise((done) => server.close(done)),
			});
		});
	});
}

function respondChatCompletion(res, request, reply) {
	const model = request?.model ?? "faux-model";
	const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
	if (request?.stream === false) {
		res.writeHead(200, { "content-type": "application/json" });
		res.end(
			JSON.stringify({
				id: "faux-completion",
				object: "chat.completion",
				created: 1,
				model,
				choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
				usage,
			}),
		);
		return;
	}
	res.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive",
	});
	const writeChunk = (delta, finishReason = null, extra = {}) => {
		res.write(
			`data: ${JSON.stringify({
				id: "faux-completion",
				object: "chat.completion.chunk",
				created: 1,
				model,
				choices: [{ index: 0, delta, finish_reason: finishReason }],
				...extra,
			})}\n\n`,
		);
	};
	const splitAt = Math.ceil(reply.length / 2);
	writeChunk({ role: "assistant" });
	writeChunk({ content: reply.slice(0, splitAt) });
	writeChunk({ content: reply.slice(splitAt) });
	writeChunk({}, "stop", { usage });
	res.write("data: [DONE]\n\n");
	res.end();
}
