/**
 * Minimal OpenAI-compatible chat-completions server for desktop e2e tests.
 * Deterministic: completions answer from a scripted step sequence (or a fixed
 * reply), streamed as SSE when the client asks for streaming. No network
 * beyond 127.0.0.1.
 *
 * Steps: `{ reply: "text" }` or `{ toolCalls: [{ id, name, arguments }] }`
 * (arguments as a plain object). Requests past the end of the script repeat
 * the last step.
 */

import { createServer } from "node:http";

export function startFauxOpenAiServer({ reply = "Hello from faux.", script } = {}) {
	const requests = [];
	const steps = script && script.length > 0 ? script : [{ reply }];
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
				const step = steps[Math.min(requests.length, steps.length - 1)];
				requests.push({ url: req.url, body: parsed });
				respondChatCompletion(res, parsed, step);
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

function toWireToolCalls(toolCalls) {
	return toolCalls.map((call, index) => ({
		index,
		id: call.id ?? `call_${index + 1}`,
		type: "function",
		function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
	}));
}

function respondChatCompletion(res, request, step) {
	const model = request?.model ?? "faux-model";
	const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
	const toolCalls = step.toolCalls ? toWireToolCalls(step.toolCalls) : undefined;
	const reply = step.reply ?? "";

	if (request?.stream === false) {
		res.writeHead(200, { "content-type": "application/json" });
		res.end(
			JSON.stringify({
				id: "faux-completion",
				object: "chat.completion",
				created: 1,
				model,
				choices: [
					{
						index: 0,
						message: toolCalls
							? { role: "assistant", content: null, tool_calls: toolCalls }
							: { role: "assistant", content: reply },
						finish_reason: toolCalls ? "tool_calls" : "stop",
					},
				],
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
	writeChunk({ role: "assistant" });
	if (toolCalls) {
		for (const call of toolCalls) {
			writeChunk({
				tool_calls: [
					{ index: call.index, id: call.id, type: "function", function: { name: call.function.name, arguments: "" } },
				],
			});
			writeChunk({ tool_calls: [{ index: call.index, function: { arguments: call.function.arguments } }] });
		}
		writeChunk({}, "tool_calls", { usage });
	} else {
		const splitAt = Math.ceil(reply.length / 2);
		writeChunk({ content: reply.slice(0, splitAt) });
		writeChunk({ content: reply.slice(splitAt) });
		writeChunk({}, "stop", { usage });
	}
	res.write("data: [DONE]\n\n");
	res.end();
}
