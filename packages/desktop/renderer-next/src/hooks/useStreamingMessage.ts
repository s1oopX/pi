import { useStore } from "../store";

/**
 * Returns the current messages array and a stable reference to the last message
 * that may be actively streaming. Used by MessageList to only re-render the
 * streaming tail instead of the entire list.
 */
export function useStreamingMessage() {
  const messages = useStore((s) => s.messages);
  const isStreaming = useStore((s) => s.isStreaming);
  const activeMessageIndex = useStore((s) => s.activeMessageIndex);
  const streamingIndex =
    isStreaming &&
    activeMessageIndex !== null &&
    messages[activeMessageIndex]?.role === "assistant"
      ? activeMessageIndex
      : -1;

  return {
    messages,
    isStreaming,
    streamingMessage: streamingIndex >= 0 ? messages[streamingIndex] : null,
    streamingIndex,
  };
}
