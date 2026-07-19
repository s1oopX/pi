const INTERACTIVE_METHODS = new Set(["confirm", "select", "input", "editor"]);

export function createPendingExtensionUIRequestStore() {
	const requests = new Map();

	return {
		track(payload) {
			if (
				payload?.type === "extension_ui_request" &&
				typeof payload.id === "string" &&
				INTERACTIVE_METHODS.has(payload.method)
			) {
				requests.set(payload.id, payload);
				return;
			}
			if (payload?.type === "extension_ui_request_closed" && typeof payload.id === "string") {
				requests.delete(payload.id);
			}
		},
		remove(id) {
			requests.delete(id);
		},
		clear() {
			requests.clear();
		},
		list() {
			return [...requests.values()];
		},
	};
}
