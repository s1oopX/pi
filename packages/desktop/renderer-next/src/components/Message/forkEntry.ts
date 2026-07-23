import type { Message } from "../../ipc/types";

// Extracts the plain text of a user message the same way the fork list does:
// concatenate text blocks. Separator choice is irrelevant here because callers
// compare with whitespace-normalized equality, not exact string identity.
function userMessageText(message: Message): string {
  if (message.role !== "user") return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

// Collapse whitespace so text sourced from differently-joined block arrays
// (backend joins with "", the desktop renderer joins with "\n\n") still matches.
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export interface ForkMessageRef {
  entryId: string;
  text: string;
}

/**
 * Maps a displayed user message to its fork entry id.
 *
 * The message list carries no entry id; the backend exposes fork points
 * separately via `get_fork_messages`, which lists user messages that have
 * non-empty text, in session order. This mirrors that filter over the displayed
 * messages and pairs the Nth forkable user message with the Nth fork entry,
 * validating the pairing by whitespace-normalized text equality.
 *
 * @param messages Displayed messages, in order.
 * @param forkMessages Fork points from `get_fork_messages`, in session order.
 * @param targetIndex Index into `messages` of the user message being edited.
 * @returns The matching entry id, or null when no confident match exists.
 */
export function resolveForkEntryId(
  messages: readonly Message[],
  forkMessages: readonly ForkMessageRef[],
  targetIndex: number,
): string | null {
  const target = messages[targetIndex];
  if (!target || target.role !== "user") return null;
  const targetText = normalize(userMessageText(target));
  if (!targetText) return null;

  // Count forkable (non-empty-text) user messages up to and including target;
  // that ordinal indexes into the fork list, which applies the same filter.
  let forkableOrdinal = -1;
  for (let index = 0; index <= targetIndex; index++) {
    const message = messages[index];
    if (message.role !== "user") continue;
    if (!normalize(userMessageText(message))) continue;
    forkableOrdinal += 1;
  }

  const candidate = forkMessages[forkableOrdinal];
  if (!candidate) return null;
  if (normalize(candidate.text) !== targetText) return null;
  return candidate.entryId;
}
