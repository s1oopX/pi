import type { Message } from "../../ipc/types";

/**
 * Plain text of the assistant's most recent reply: the text blocks of the
 * last assistant message that has any. Tool-only assistant turns (still
 * running or pure tool dispatch) are skipped so the command copies prose,
 * not `[tool: …]` markers or thinking.
 */
export function findLastReplyCopyText(messages: readonly Message[]): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n\n")
      .trim();
    if (text) return text;
  }
  return null;
}
