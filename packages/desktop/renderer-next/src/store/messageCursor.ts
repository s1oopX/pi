import type { Message } from "../ipc/types";

export type MessageEventType = "message_start" | "message_update" | "message_end";

export interface MessageCursorState {
  messages: Message[];
  // Index of the message opened by the current message_start, or null when no
  // message is actively streaming.
  activeMessageIndex: number | null;
}

/**
 * Deterministic streaming-cursor reducer for RPC message events.
 *
 * RPC message events (message_start/update/end) carry no stable top-level id, so
 * matching by role+timestamp is ambiguous when several messages share a second
 * or when consecutive assistant messages interleave with tool calls. Instead we
 * track the index opened by message_start and mutate only that slot until
 * message_end closes it. This is pure so it can be unit tested without a store.
 */
export function reduceMessageEvent(
  state: MessageCursorState,
  message: Message,
  eventType: MessageEventType,
): MessageCursorState {
  const messages = [...state.messages];

  switch (eventType) {
    case "message_start": {
      messages.push(message);
      return { messages, activeMessageIndex: messages.length - 1 };
    }
    case "message_update": {
      const index = state.activeMessageIndex;
      if (index !== null && index < messages.length) {
        messages[index] = message;
        return { messages, activeMessageIndex: index };
      }
      // No active cursor (update without a preceding start): append and adopt it
      // rather than guessing a target to overwrite.
      messages.push(message);
      return { messages, activeMessageIndex: messages.length - 1 };
    }
    case "message_end": {
      const index = state.activeMessageIndex;
      if (index !== null && index < messages.length) {
        messages[index] = message;
      } else {
        messages.push(message);
      }
      return { messages, activeMessageIndex: null };
    }
    default:
      return { messages, activeMessageIndex: state.activeMessageIndex };
  }
}
