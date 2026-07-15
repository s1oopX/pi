import type { Message } from "../../ipc/types";

// A toolResult message is the outcome of an earlier assistant toolCall block,
// linked by toolCallId. The desktop chat renders them inline inside the tool
// call card instead of as standalone messages, so we (1) build an id -> result
// lookup and (2) mark which message indices should be hidden from the main list.
export interface ToolPairing {
  // Map of toolCallId to its result message.
  resultsByCallId: Map<string, Extract<Message, { role: "toolResult" }>>;
  // Set of message indices to skip rendering (the standalone toolResult rows).
  hiddenIndices: Set<number>;
}

export function computeToolPairing(messages: Message[]): ToolPairing {
  const resultsByCallId = new Map<string, Extract<Message, { role: "toolResult" }>>();
  const hiddenIndices = new Set<number>();

  messages.forEach((message, index) => {
    if (message.role === "toolResult" && message.toolCallId) {
      resultsByCallId.set(message.toolCallId, message);
      hiddenIndices.add(index);
    }
  });

  return { resultsByCallId, hiddenIndices };
}

export interface FileChange {
  path: string;
  tool: "write" | "edit";
  callId?: string;
  isError: boolean;
}

// Extracts the file path from a write/edit tool call's arguments.
function extractPath(args: Record<string, unknown>): string | undefined {
  const p = args?.path;
  return typeof p === "string" && p.trim() ? p : undefined;
}

// Scans an assistant message's tool calls for write/edit operations and pairs
// each with its result status, producing a flat list of file changes for the
// aggregated "N files changed" card.
export function extractFileChanges(
  message: Extract<Message, { role: "assistant" }>,
  resultsByCallId: Map<string, Extract<Message, { role: "toolResult" }>>,
): FileChange[] {
  const changes: FileChange[] = [];
  for (const block of message.content) {
    if (block.type !== "toolCall") continue;
    if (block.name !== "write" && block.name !== "edit") continue;
    const path = extractPath(block.arguments);
    if (!path) continue;
    const result = block.id ? resultsByCallId.get(block.id) : undefined;
    changes.push({
      path,
      tool: block.name,
      callId: block.id,
      isError: Boolean(result?.isError),
    });
  }
  return changes;
}
