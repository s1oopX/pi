import { useRef, useCallback } from "react";
import { useStore } from "../store";
import type { Message } from "../ipc/types";

/**
 * Returns the current messages array and a stable reference to the last message
 * that may be actively streaming. Used by MessageList to only re-render the
 * streaming tail instead of the entire list.
 */
export function useStreamingMessage() {
  const messages = useStore((s) => s.messages);
  const isStreaming = useStore((s) => s.isStreaming);
  const lastMessageRef = useRef<Message | null>(null);

  const getStreamingMessage = useCallback((): Message | null => {
    if (!isStreaming || messages.length === 0) return null;
    const last = messages[messages.length - 1];
    if (last.role === "assistant") {
      lastMessageRef.current = last;
      return last;
    }
    return null;
  }, [messages, isStreaming]);

  return {
    messages,
    isStreaming,
    streamingMessage: getStreamingMessage(),
    streamingIndex: isStreaming && messages.length > 0 && messages[messages.length - 1].role === "assistant"
      ? messages.length - 1
      : -1,
  };
}
