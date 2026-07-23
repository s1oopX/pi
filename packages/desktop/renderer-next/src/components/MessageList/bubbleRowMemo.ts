import type { Message } from "../../ipc/types";
import type { ToolExecutionsByCallId } from "../../store";

type ResultsByCallId = ReadonlyMap<string, Extract<Message, { role: "toolResult" }>>;

export interface BubbleRowProps {
  message: Message;
  suppressError: boolean;
  resultsByCallId: ResultsByCallId;
  toolExecutionsByCallId: ToolExecutionsByCallId;
}

// The tool-call ids a message cares about. Only assistant messages carry
// toolCall blocks; every other role reads nothing from the pairing maps.
function toolCallIds(message: Message): string[] {
  if (message.role !== "assistant") return [];
  const ids: string[] = [];
  for (const block of message.content) {
    if (block.type === "toolCall" && typeof block.id === "string") ids.push(block.id);
  }
  return ids;
}

/**
 * Custom equality for the memoized, non-streaming message rows.
 *
 * `resultsByCallId` and `toolExecutionsByCallId` are rebuilt into fresh
 * container references on every streaming token (the messages array changes,
 * so the derived pairing map does too). A default shallow comparison therefore
 * fails for every visible historical row on every token and forces a full
 * re-render (including react-markdown reparse).
 *
 * The individual entries, however, stay referentially stable until they
 * actually change: finalized toolResult objects keep their identity until a
 * full transcript refresh, and the executions record is updated with a spread
 * that only replaces the changed call. So we skip the re-render when the
 * message object is unchanged and none of the entries this row reads have
 * changed by reference.
 *
 * This only affects parent-prop-driven renders. `AssistantContent` subscribes
 * to `activeTool`/compaction through the store directly, and memo never blocks
 * subscription-driven renders, so live-status behavior is unchanged.
 */
export function areBubbleRowPropsEqual(prev: BubbleRowProps, next: BubbleRowProps): boolean {
  if (prev.message !== next.message) return false;
  if (prev.suppressError !== next.suppressError) return false;

  // message identity is equal past this point, so both sides expose the same
  // toolCall ids; reading from `next` is sufficient.
  const ids = toolCallIds(next.message);
  for (const id of ids) {
    if (prev.resultsByCallId.get(id) !== next.resultsByCallId.get(id)) return false;
    if (prev.toolExecutionsByCallId[id] !== next.toolExecutionsByCallId[id]) return false;
  }
  return true;
}
