import type { Message } from "../../ipc/types";
import type { ToolExecutionsByCallId } from "../../store";
import { resolveToolPhase, type ToolPhase } from "../Message/toolPresentation";

type ToolResult = Extract<Message, { role: "toolResult" }>;

// A toolResult message is the outcome of an earlier assistant toolCall block,
// linked by toolCallId. The desktop chat renders them inline inside the tool
// call card instead of as standalone messages, so we (1) build an id -> result
// lookup and (2) mark which message indices should be hidden from the main list.
export interface ToolPairing {
  // Map of toolCallId to its result message.
  resultsByCallId: Map<string, ToolResult>;
  // Set of message indices to skip rendering (the standalone toolResult rows).
  hiddenIndices: Set<number>;
}

export function computeToolPairing(messages: Message[]): ToolPairing {
  const resultsByCallId = new Map<string, ToolResult>();
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
  callId: string;
  phase: ToolPhase;
  resultText?: string;
}

export interface FileChangeGroup {
  startIndex: number;
  changes: FileChange[];
}

export interface FileChangeDisplayPlan {
  groupsByStartIndex: Map<number, FileChangeGroup>;
  hiddenCallIds: Set<string>;
}

// Extracts the file path from a write/edit tool call's arguments.
function extractPath(args: Record<string, unknown>): string | undefined {
  const p = args.path;
  return typeof p === "string" && p.trim() ? p : undefined;
}

function contentToText(result: ToolResult): string {
  return result.content
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.type === "text" ? block.text : "")
    .join("\n\n");
}

function hasImageResult(result: ToolResult | undefined): boolean {
  return Boolean(result?.content.some((block) => block.type === "image"));
}

function meaningfulMutationResult(tool: "write" | "edit", result: ToolResult | undefined): string | undefined {
  if (!result) return undefined;
  const text = contentToText(result).trim();
  if (!text) return undefined;
  if (result.isError) return text;
  const isDefaultSuccess = tool === "write"
    ? /^Successfully wrote \d+ bytes to .+$/.test(text)
    : /^Successfully replaced \d+ block\(s\) in .+\.$/.test(text);
  return isDefaultSuccess ? undefined : text;
}

// Replaces each contiguous run of valid write/edit calls with one file-change
// card at the first call's position. Calls with no path or an image result stay
// as ordinary tool cards so no result content is lost.
export function buildFileChangeDisplayPlan(
  message: Extract<Message, { role: "assistant" }>,
  resultsByCallId: ReadonlyMap<string, ToolResult>,
  executionsByCallId: ToolExecutionsByCallId,
  streaming: boolean,
): FileChangeDisplayPlan {
  const groupsByStartIndex = new Map<number, FileChangeGroup>();
  const hiddenCallIds = new Set<string>();
  let currentStart: number | null = null;
  let currentChanges: FileChange[] = [];

  function flush(): void {
    if (currentStart !== null && currentChanges.length > 0) {
      groupsByStartIndex.set(currentStart, { startIndex: currentStart, changes: currentChanges });
    }
    currentStart = null;
    currentChanges = [];
  }

  message.content.forEach((block, index) => {
    if (block.type !== "toolCall" || (block.name !== "write" && block.name !== "edit")) {
      flush();
      return;
    }
    const path = extractPath(block.arguments);
    const result = resultsByCallId.get(block.id);
    if (!path || hasImageResult(result)) {
      flush();
      return;
    }
    currentStart ??= index;
    currentChanges.push({
      path,
      tool: block.name,
      callId: block.id,
      phase: resolveToolPhase(block.id, result, executionsByCallId, streaming),
      resultText: meaningfulMutationResult(block.name, result),
    });
    hiddenCallIds.add(block.id);
  });

  flush();
  return { groupsByStartIndex, hiddenCallIds };
}
