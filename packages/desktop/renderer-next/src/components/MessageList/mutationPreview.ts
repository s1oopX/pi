/**
 * Build scannable unified-diff previews from edit/write tool arguments.
 * RPC toolResult messages do not carry patch details, so the desktop client
 * reconstructs a display patch from the call payload for Codex-style review.
 */

const PREVIEW_LINE_LIMIT = 200;
const PREVIEW_CHAR_LIMIT = 12_000;

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function normalizeNewlines(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function truncateLines(lines: string[], limit = PREVIEW_LINE_LIMIT): { lines: string[]; truncated: boolean } {
	if (lines.length <= limit) return { lines, truncated: false };
	return { lines: lines.slice(0, limit), truncated: true };
}

function clipPatch(patch: string): string {
	if (patch.length <= PREVIEW_CHAR_LIMIT) return patch;
	return `${patch.slice(0, PREVIEW_CHAR_LIMIT)}\n…`;
}

function displayPath(path: string): string {
	return path.replace(/\\/g, "/");
}

/** Synthetic patch for a newly written file (all lines added). */
export function buildWritePreviewPatch(path: string, content: string): string {
	const normalized = normalizeNewlines(content);
	const { lines, truncated } = truncateLines(normalized.length ? normalized.split("\n") : [""]);
	const file = displayPath(path);
	const body = lines.map((line) => `+${line}`).join("\n");
	const header = [
		`--- /dev/null`,
		`+++ b/${file}`,
		`@@ -0,0 +1,${lines.length} @@`,
	].join("\n");
	const note = truncated ? "\n… (preview truncated)" : "";
	return clipPatch(`${header}\n${body}${note}`);
}

interface TextEdit {
	oldText: string;
	newText: string;
}

function collectEdits(args: Record<string, unknown>): TextEdit[] {
	const edits: TextEdit[] = [];
	if (Array.isArray(args.edits)) {
		for (const item of args.edits) {
			if (!item || typeof item !== "object") continue;
			const record = item as Record<string, unknown>;
			const oldText = asString(record.oldText);
			const newText = asString(record.newText);
			if (oldText === undefined || newText === undefined) continue;
			edits.push({ oldText, newText });
		}
	}
	// Legacy single-edit shape
	if (edits.length === 0) {
		const oldText = asString(args.oldText);
		const newText = asString(args.newText);
		if (oldText !== undefined && newText !== undefined) {
			edits.push({ oldText, newText });
		}
	}
	return edits;
}

function editHunk(oldText: string, newText: string): string {
	const oldLines = normalizeNewlines(oldText).split("\n");
	const newLines = normalizeNewlines(newText).split("\n");
	const oldPart = truncateLines(oldLines);
	const newPart = truncateLines(newLines);
	const removed = oldPart.lines.map((line) => `-${line}`).join("\n");
	const added = newPart.lines.map((line) => `+${line}`).join("\n");
	const header = `@@ -1,${oldPart.lines.length} +1,${newPart.lines.length} @@`;
	const note = oldPart.truncated || newPart.truncated ? "\n… (preview truncated)" : "";
	return `${header}\n${removed}\n${added}${note}`;
}

/** Synthetic multi-hunk patch from edit tool replacements. */
export function buildEditPreviewPatch(path: string, args: Record<string, unknown>): string | undefined {
	const edits = collectEdits(args);
	if (edits.length === 0) return undefined;
	const file = displayPath(path);
	const hunks = edits.map((edit) => editHunk(edit.oldText, edit.newText));
	const header = [`--- a/${file}`, `+++ b/${file}`].join("\n");
	return clipPatch(`${header}\n${hunks.join("\n")}`);
}

export function buildMutationPreviewPatch(
	tool: "write" | "edit",
	path: string,
	args: Record<string, unknown>,
): string | undefined {
	if (tool === "write") {
		const content = asString(args.content);
		if (content === undefined) return undefined;
		return buildWritePreviewPatch(path, content);
	}
	return buildEditPreviewPatch(path, args);
}

export function looksLikeUnifiedDiff(text: string): boolean {
	const trimmed = text.trimStart();
	return (
		trimmed.startsWith("---") ||
		trimmed.startsWith("diff --git") ||
		trimmed.startsWith("@@")
	);
}
