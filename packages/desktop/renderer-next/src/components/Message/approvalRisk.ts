import type { ExtensionUIRequestEvent } from "../../ipc/types";

// Patterns that suggest a destructive or hard-to-reverse operation. Matched
// case-insensitively against the request title + message so the approval card
// can raise its visual prominence (Codex-style elevated-risk framing). This is
// a presentation hint only; the backend still gates the actual operation.
const ELEVATED_RISK_PATTERNS: RegExp[] = [
  /\brm\s+-[a-z]*[rf]/i, // rm -rf, rm -f, rm -r
  /\brmdir\b/i,
  /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|push\s+.*--force|push\s+.*-f\b)/i,
  /--force\b/i,
  /\bforce[- ]push\b/i,
  /\bdrop\s+(table|database|schema)\b/i,
  /\btruncate\s+table\b/i,
  /\bdelete\s+from\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\b(shutdown|reboot|halt)\b/i,
  /\bchmod\s+-R\b/i,
  /\bchown\s+-R\b/i,
  />\s*\/dev\/sd[a-z]/i,
  /\bcurl\b[^\n]*\|\s*(sudo\s+)?(sh|bash)\b/i,
  /\bwget\b[^\n]*\|\s*(sudo\s+)?(sh|bash)\b/i,
  /\bsudo\b/i,
];

function collectText(request: ExtensionUIRequestEvent): string {
  const parts: string[] = [];
  if (typeof request.title === "string") parts.push(request.title);
  if (typeof request.message === "string") parts.push(request.message);
  return parts.join("\n");
}

/**
 * Heuristically classifies whether a confirm request describes a destructive or
 * otherwise hard-to-reverse operation, so the UI can frame it with elevated
 * prominence. Presentation-only; does not change what the backend allows.
 */
export function isElevatedRisk(request: ExtensionUIRequestEvent): boolean {
  const text = collectText(request);
  if (!text.trim()) return false;
  return ELEVATED_RISK_PATTERNS.some((pattern) => pattern.test(text));
}
