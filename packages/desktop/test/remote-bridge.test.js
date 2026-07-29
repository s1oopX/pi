import assert from "node:assert/strict";
import test from "node:test";
import remoteBridge, { evaluateToolApproval } from "../assets/remote-bridge.js";

test("remote bridge registers approval, plan, and goal capabilities", () => {
	const flags = [];
	const tools = [];
	const handlers = [];
	remoteBridge({
		registerFlag: (name) => flags.push(name),
		registerTool: ({ name }) => tools.push(name),
		on: (event) => handlers.push(event),
	});
	assert.deepEqual(flags, ["permission-mode"]);
	assert.deepEqual(tools, ["update_plan", "create_goal", "get_goal", "update_goal"]);
	assert.deepEqual(handlers, ["tool_call", "input", "before_agent_start"]);
});

test("remote approval keeps risky commands and outside writes gated in auto mode", () => {
	assert.equal(evaluateToolApproval({ toolName: "bash", input: { command: "git status" } }, "/work", "auto").gate, false);
	assert.equal(evaluateToolApproval({ toolName: "bash", input: { command: "sudo rm -rf /tmp/x" } }, "/work", "auto").gate, true);
	assert.equal(evaluateToolApproval({ toolName: "write", input: { path: "../secret" } }, "/work", "auto").gate, true);
});
