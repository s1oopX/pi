import assert from "node:assert/strict";
import test from "node:test";
import { createPendingExtensionUIRequestStore } from "../src/pending-extension-ui-requests.js";

test("pending extension UI request store tracks interactive requests and replays the latest payload", () => {
	const store = createPendingExtensionUIRequestStore();
	const request = { type: "extension_ui_request", id: "request-1", method: "confirm", title: "Initial" };
	store.track(request);
	store.track({ ...request, title: "Updated" });
	store.track({ type: "extension_ui_request", id: "notify-1", method: "notify" });

	assert.deepEqual(store.list(), [{ ...request, title: "Updated" }]);

	store.track({ type: "extension_ui_request_closed", id: "request-1", reason: "aborted" });
	assert.deepEqual(store.list(), []);
});

test("clearing the store drops requests from a stopped backend", () => {
	const store = createPendingExtensionUIRequestStore();
	store.track({ type: "extension_ui_request", id: "request-1", method: "input" });
	store.clear();
	assert.deepEqual(store.list(), []);
});
