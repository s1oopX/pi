import type { Message } from "../ipc/types";

export type MessageEventType = "message_start" | "message_update" | "message_end";

export interface MessageCursorState {
  messages: Message[];
  // Index of the message opened by the current message_start, or null when no
  // message is actively streaming.
  activeMessageIndex: number | null;
}

/**
 * Rebase an open event-stream message onto a refreshed finalized transcript.
 * A `get_messages` response can race the event stream and either omit the
 * active partial or contain an older version, so a refresh must carry that
 * partial forward unless its identity is proven.
 */
export function reconcileMessageSnapshot(
  state: MessageCursorState,
  snapshot: readonly Message[],
  isStreaming: boolean,
): MessageCursorState {
  const activeMessageIndex = state.activeMessageIndex;
  if (!isStreaming || activeMessageIndex === null) {
    return { messages: [...snapshot], activeMessageIndex: null };
  }
  const activeMessage = state.messages[activeMessageIndex];
  if (activeMessage === undefined) {
    return { messages: [...snapshot], activeMessageIndex: null };
  }
  const matchingIndex = findSnapshotMessageIndex(snapshot, activeMessage, activeMessageIndex);
  if (matchingIndex !== null) {
    return { messages: [...snapshot], activeMessageIndex: matchingIndex };
  }
  return { messages: [...snapshot, activeMessage], activeMessageIndex: snapshot.length };
}

function findSnapshotMessageIndex(
  snapshot: readonly Message[],
  activeMessage: Message,
  activeMessageIndex: number,
): number | null {
  // A provider response id is the only stable identity exposed by the wire
  // contract. It is safe to locate it anywhere in the snapshot, but never to
  // fall back to content matching when one side has an id and the other does
  // not (the id often appears partway through a stream).
  if (activeMessage.role === "assistant" && activeMessage.responseId !== undefined) {
    for (let index = snapshot.length - 1; index >= 0; index--) {
      if (isSnapshotVersion(activeMessage, snapshot[index])) return index;
    }
    return null;
  }

  // Without a response id, content growth is not enough to prove identity:
  // two assistant messages can share a timestamp and one can be a prefix of
  // the other. Only the slot opened by message_start may be reused, and only
  // when the wire messages are exactly equal.
  if (activeMessageIndex < 0 || activeMessageIndex >= snapshot.length) return null;
  return isSnapshotVersion(activeMessage, snapshot[activeMessageIndex])
    ? activeMessageIndex
    : null;
}

function isSnapshotVersion(active: Message, candidate: Message): boolean {
  if (active.role !== candidate.role) return false;

  if (active.role === "assistant" && candidate.role === "assistant") {
    if (active.api !== candidate.api || active.provider !== candidate.provider || active.model !== candidate.model) {
      return false;
    }
    const activeResponseId = active.responseId;
    const candidateResponseId = candidate.responseId;
    if (activeResponseId !== undefined || candidateResponseId !== undefined) {
      return activeResponseId !== undefined &&
        candidateResponseId !== undefined &&
        activeResponseId === candidateResponseId &&
        active.timestamp === candidate.timestamp;
    }
  }

  return active.timestamp === candidate.timestamp && JSON.stringify(active) === JSON.stringify(candidate);
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
