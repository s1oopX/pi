import assert from "node:assert/strict";
import test from "node:test";
import { filterCustomModels, isCustomModelConfigured } from "../renderer/model-scope.js";

const customConfig = {
	providers: {
		"my-gateway": {
			models: [{ id: "private-model" }],
		},
	},
};

test("shows only models declared by custom providers", () => {
	const models = [
		{ provider: "openai", id: "gpt-5" },
		{ provider: "anthropic", id: "claude-opus" },
		{ provider: "my-gateway", id: "private-model" },
		{ provider: "my-gateway", id: "undeclared-model" },
	];
	assert.deepEqual(filterCustomModels(models, customConfig), [{ provider: "my-gateway", id: "private-model" }]);
});

test("rejects a selected model unless it is in custom configuration", () => {
	assert.equal(isCustomModelConfigured({ provider: "my-gateway", id: "private-model" }, customConfig), true);
	assert.equal(isCustomModelConfigured({ provider: "openai", id: "gpt-5" }, customConfig), false);
	assert.equal(isCustomModelConfigured(undefined, customConfig), false);
});
