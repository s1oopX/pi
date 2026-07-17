/**
 * Extract a unified-diff patch from toolResult.details when coding-agent
 * tools (edit/write) attach { patch, diff }.
 */

import { looksLikeUnifiedDiff } from "./mutationPreview";

export function extractPatchFromToolDetails(details: unknown): string | undefined {
  if (!details || typeof details !== "object") return undefined;
  const record = details as Record<string, unknown>;
  const patch = typeof record.patch === "string" ? record.patch : undefined;
  if (patch && looksLikeUnifiedDiff(patch)) return patch;
  const diff = typeof record.diff === "string" ? record.diff : undefined;
  // Display-oriented diffs may not always look like unified patches; only accept
  // when they parse as unified so DiffView can render them.
  if (diff && looksLikeUnifiedDiff(diff)) return diff;
  return undefined;
}
