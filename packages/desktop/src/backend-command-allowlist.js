/**
 * Allowlists for backend commands accepted from the renderer.
 *
 * The RPC backend already rejects unknown command types, but the main process
 * still refuses anything outside the renderer's typed command surface so a
 * compromised renderer cannot reach backend commands the UI never sends.
 * Mirrors `BackendCommand` / `BackendSendCommand` in
 * `renderer-next/src/ipc/types.ts`.
 */

export const BACKEND_REQUEST_COMMAND_TYPES = new Set([
	"abort",
	"abort_bash",
	"abort_retry",
	"bash",
	"clone",
	"compact",
	"cycle_model",
	"cycle_thinking_level",
	"export_html",
	"fetch_provider_models",
	"follow_up",
	"fork",
	"get_auth_status",
	"get_available_models",
	"get_commands",
	"get_custom_models",
	"get_entries",
	"get_fork_messages",
	"get_last_assistant_text",
	"get_messages",
	"get_project_trust_entries",
	"get_resources",
	"get_session_stats",
	"get_sessions",
	"get_state",
	"get_tree",
	"new_session",
	"prompt",
	"remove_api_key",
	"remove_custom_model",
	"remove_custom_provider",
	"replace_custom_models",
	"set_api_key",
	"set_auto_compaction",
	"set_auto_retry",
	"set_extension_flag",
	"set_follow_up_mode",
	"set_model",
	"set_project_trust",
	"set_project_trust_entry",
	"set_session_name",
	"set_steering_mode",
	"set_thinking_level",
	"steer",
	"switch_session",
	"test_custom_model",
	"test_model",
	"upsert_custom_model",
]);

export const BACKEND_SEND_COMMAND_TYPES = new Set(["extension_ui_response"]);

/**
 * @param {unknown} command
 * @param {ReadonlySet<string>} allowedTypes
 * @returns {string | null} rejection reason, or null when the command may pass
 */
export function describeBackendCommandRejection(command, allowedTypes) {
	if (!command || typeof command !== "object" || Array.isArray(command)) {
		return "Backend command must be an object";
	}
	const { type } = /** @type {{ type?: unknown }} */ (command);
	if (typeof type !== "string" || type.length === 0) {
		return "Backend command requires a string type";
	}
	if (!allowedTypes.has(type)) {
		return `Backend command type is not allowed: ${type}`;
	}
	return null;
}
