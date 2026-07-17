import type { ToolPhase } from "./toolPresentation";

const DEFAULT_MAX_LINES = 5;
const DEFAULT_MAX_CHARS = 2_000;

export interface ToolOutputSummary {
  preview: string;
  truncated: boolean;
  lineCount: number;
}

/**
 * Collapse long tool output for Codex-style process rows.
 * Prefer the last N lines so command tails stay scannable.
 */
export function summarizeToolOutput(
  text: string,
  options: { maxLines?: number; maxChars?: number } = {},
): ToolOutputSummary {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.length > 0 ? normalized.split("\n") : [];
  const lineCount = lines.length;

  let previewLines = lines;
  let truncated = false;
  if (lines.length > maxLines) {
    previewLines = lines.slice(lines.length - maxLines);
    truncated = true;
  }

  let preview = previewLines.join("\n");
  if (truncated) {
    preview = `…\n${preview}`;
  }
  if (preview.length > maxChars) {
    preview = `…${preview.slice(preview.length - maxChars + 1)}`;
    truncated = true;
  }

  return { preview, truncated, lineCount };
}

/** Error bodies open by default; success/running stay collapsed. */
export function shouldAutoExpandToolBody(phase: ToolPhase, hasBody: boolean): boolean {
  if (!hasBody) return false;
  return phase === "error";
}
