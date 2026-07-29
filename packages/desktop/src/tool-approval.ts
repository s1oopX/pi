/**
 * Pi Studio tool-approval extension (bundled, inline).
 *
 * pi has no built-in permission system; tool gating is an extension
 * capability. Pi Studio ships this extension so the permission-mode selector
 * (full / auto / ask) actually enforces something. It registers the
 * `permission-mode` flag the desktop UI drives, and gates tool calls via the
 * `tool_call` hook — which the desktop surfaces as a native inline approval
 * dialog (ctx.ui.confirm) in RPC mode.
 *
 * Modes:
 * - full: run everything without asking.
 * - auto: ask only for risky operations (destructive/privileged/network bash,
 *   file writes outside the workspace, computer control, or image generation).
 * - ask: ask before commands, file changes, computer use, and image generation.
 */

import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ToolCallEvent } from "../../coding-agent/src/index.ts";

export const PERMISSION_MODE_FLAG = "permission-mode";

export type PermissionMode = "full" | "auto" | "ask";

const WRITE_TOOLS = new Set(["edit", "write", "multiedit"]);

// Destructive, privileged, or remote-code bash shapes that warrant a prompt
// even in auto mode. Intentionally conservative: false negatives fall through
// to normal execution, false positives only add one confirmation.
const RISKY_BASH_PATTERNS: RegExp[] = [
	/\brm\s+(?:-\w*[rf]|--recursive|--force)/i,
	/\b(?:sudo|doas)\b/i,
	/\b(?:chmod|chown)\b[^\n]*\b777\b/i,
	/\b(?:chmod|chown)\b\s+-\w*[rR]\b/i,
	/\bgit\s+push\b[^\n]*(?:--force|-f|\s\+)/i,
	/\b(?:mkfs|fdisk)\b/i,
	/\bdd\b[^\n]*\bof=/i,
	/:\s*\(\s*\)\s*\{[^}]*\|/, // fork bomb
	/>\s*\/dev\/(?:sd|nvme|disk)/i,
	/\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/i,
];

export interface ToolApprovalDecision {
	gate: boolean;
	title: string;
	detail: string;
}

export function resolvePermissionMode(value: boolean | string | undefined): PermissionMode {
	return value === "full" || value === "auto" ? value : "ask";
}

function isRiskyBash(command: string): boolean {
	return RISKY_BASH_PATTERNS.some((pattern) => pattern.test(command));
}

function isOutsideWorkspace(cwd: string, targetPath: string): boolean {
	if (!cwd) return false;
	const absolute = isAbsolute(targetPath) ? targetPath : resolve(cwd, targetPath);
	const rel = relative(resolve(cwd), absolute);
	return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

/**
 * Pure gating decision for a tool call. Read-only tools are never gated.
 */
export function evaluateToolApproval(event: ToolCallEvent, cwd: string, mode: PermissionMode): ToolApprovalDecision {
	if (mode === "full") return { gate: false, title: "", detail: "" };

	if (event.toolName === "bash") {
		const command = String(event.input.command ?? "");
		const risky = isRiskyBash(command);
		const gate = mode === "ask" || risky;
		return {
			gate,
			title: risky ? "Run a potentially dangerous command?" : "Run command?",
			detail: command,
		};
	}

	if (WRITE_TOOLS.has(event.toolName)) {
		const targetPath = String((event.input as { path?: unknown }).path ?? "");
		const outside = isOutsideWorkspace(cwd, targetPath);
		const gate = mode === "ask" || outside;
		const verb = event.toolName === "write" ? "Write" : "Edit";
		return {
			gate,
			title: outside ? `${verb} a file outside the workspace?` : `${verb} file?`,
			detail: targetPath,
		};
	}

	if (event.toolName === "computer_use") {
		const action = String((event.input as { action?: unknown }).action ?? "");
		const readOnly = action === "screenshot" || action === "wait";
		return {
			gate: mode === "ask" || !readOnly,
			title: readOnly ? "Share the screen with the agent?" : "Let the agent control the computer?",
			detail: action || "computer action",
		};
	}

	if (event.toolName === "generate_image") {
		const prompt = String((event.input as { prompt?: unknown }).prompt ?? "")
			.replace(/\s+/g, " ")
			.trim();
		return {
			gate: true,
			title: "Generate an image?",
			detail: prompt.length > 240 ? `${prompt.slice(0, 239)}…` : prompt,
		};
	}

	return { gate: false, title: "", detail: "" };
}

export function toolApprovalExtension(pi: ExtensionAPI): void {
	pi.registerFlag(PERMISSION_MODE_FLAG, {
		type: "string",
		description: "Tool approval mode: full (allow all), auto (ask on risky), ask (ask before tool actions).",
		default: "ask",
	});

	pi.on("tool_call", async (event, ctx) => {
		const mode = resolvePermissionMode(pi.getFlag(PERMISSION_MODE_FLAG));
		const decision = evaluateToolApproval(event, ctx.cwd, mode);
		if (!decision.gate) return undefined;

		if (!ctx.hasUI) {
			return { block: true, reason: `${decision.title} No approval UI is available, so the action was blocked.` };
		}

		const approved = await ctx.ui.confirm(decision.title, decision.detail);
		return approved ? undefined : { block: true, reason: "The action was not approved." };
	});
}
