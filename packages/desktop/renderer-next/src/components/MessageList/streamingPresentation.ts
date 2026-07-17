import type { Message } from "../../ipc/types";

/**
 * List-level streaming dots are redundant when the active assistant turn
 * already shows an in-bubble Working tail.
 */
export function shouldShowListStreamingDots(options: {
  isStreaming: boolean;
  streamingIndex: number;
  messages: readonly Message[];
}): boolean {
  if (!options.isStreaming) return false;
  const { streamingIndex, messages } = options;
  if (streamingIndex < 0 || streamingIndex >= messages.length) return true;
  return messages[streamingIndex]?.role !== "assistant";
}

export function shouldAutoFollowStream(options: {
  isStreaming: boolean;
  userNearBottom: boolean;
}): boolean {
  if (!options.isStreaming) return options.userNearBottom;
  return options.userNearBottom;
}
