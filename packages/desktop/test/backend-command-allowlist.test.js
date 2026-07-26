import assert from "node:assert/strict";
import test from "node:test";
import {
	BACKEND_REQUEST_COMMAND_TYPES,
	BACKEND_SEND_COMMAND_TYPES,
	describeBackendCommandRejection,
} from "../src/backend-command-allowlist.js";

test("allows every renderer request command type", () => {
	for (const type of BACKEND_REQUEST_COMMAND_TYPES) {
		assert.equal(describeBackendCommandRejection({ type }, BACKEND_REQUEST_COMMAND_TYPES), null);
	}
	assert.equal(
		describeBackendCommandRejection({ type: "prompt", message: "hi" }, BACKEND_REQUEST_COMMAND_TYPES),
		null,
	);
});

test("rejects command types outside the renderer surface", () => {
	assert.match(
		describeBackendCommandRejection({ type: "extension_ui_response" }, BACKEND_REQUEST_COMMAND_TYPES),
		/not allowed: extension_ui_response/,
	);
	assert.match(
		describeBackendCommandRejection({ type: "shutdown" }, BACKEND_REQUEST_COMMAND_TYPES),
		/not allowed: shutdown/,
	);
});

test("rejects malformed commands", () => {
	assert.match(describeBackendCommandRejection(undefined, BACKEND_REQUEST_COMMAND_TYPES), /must be an object/);
	assert.match(describeBackendCommandRejection(null, BACKEND_REQUEST_COMMAND_TYPES), /must be an object/);
	assert.match(describeBackendCommandRejection("prompt", BACKEND_REQUEST_COMMAND_TYPES), /must be an object/);
	assert.match(describeBackendCommandRejection([], BACKEND_REQUEST_COMMAND_TYPES), /must be an object/);
	assert.match(describeBackendCommandRejection({}, BACKEND_REQUEST_COMMAND_TYPES), /requires a string type/);
	assert.match(
		describeBackendCommandRejection({ type: 42 }, BACKEND_REQUEST_COMMAND_TYPES),
		/requires a string type/,
	);
	assert.match(describeBackendCommandRejection({ type: "" }, BACKEND_REQUEST_COMMAND_TYPES), /requires a string type/);
});

test("send channel accepts only extension_ui_response", () => {
	assert.equal(
		describeBackendCommandRejection({ type: "extension_ui_response", id: "r1" }, BACKEND_SEND_COMMAND_TYPES),
		null,
	);
	assert.match(
		describeBackendCommandRejection({ type: "prompt" }, BACKEND_SEND_COMMAND_TYPES),
		/not allowed: prompt/,
	);
});
