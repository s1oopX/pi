import type { Message } from "../../ipc/types";

export type RetryCause = "rate-limit" | "server" | "connection" | "temporary";

export interface RetryErrorDisplay {
  hiddenIndices: Set<number>;
  suppressedErrorIndices: Set<number>;
}

function isAssistantError(message: Message): message is Extract<Message, { role: "assistant" }> {
  return message.role === "assistant" && message.stopReason === "error" && Boolean(message.errorMessage);
}

function hasRenderableAssistantContent(message: Extract<Message, { role: "assistant" }>): boolean {
  return message.content.some(
    (block) =>
      (block.type === "text" && Boolean(block.text)) ||
      (block.type === "thinking" && Boolean(block.thinking)) ||
      block.type === "toolCall",
  );
}

export function getRetryErrorDisplay(messages: Message[], retryActive: boolean): RetryErrorDisplay {
  const retryErrorIndices = new Set<number>();
  let pendingErrorIndex: number | null = null;

  messages.forEach((message, index) => {
    if (message.role === "user") {
      pendingErrorIndex = null;
      return;
    }
    if (message.role !== "assistant") return;

    if (pendingErrorIndex !== null) retryErrorIndices.add(pendingErrorIndex);
    pendingErrorIndex = isAssistantError(message) ? index : null;
  });

  if (retryActive && pendingErrorIndex !== null) retryErrorIndices.add(pendingErrorIndex);

  const hiddenIndices = new Set<number>();
  for (const index of retryErrorIndices) {
    const message = messages[index];
    if (message?.role === "assistant" && !hasRenderableAssistantContent(message)) hiddenIndices.add(index);
  }

  return { hiddenIndices, suppressedErrorIndices: retryErrorIndices };
}

export function classifyRetryError(errorMessage: string): { cause: RetryCause; statusCode: number | null } {
  const statusMatch = /(?:^|\s)(4\d\d|5\d\d)(?:\s|$|\{)/.exec(errorMessage);
  const statusCode = statusMatch ? Number(statusMatch[1]) : null;
  if (statusCode === 429) return { cause: "rate-limit", statusCode };
  if (statusCode !== null && statusCode >= 500) return { cause: "server", statusCode };
  if (/timeout|timed out|econn|connection|network|socket|fetch failed/i.test(errorMessage)) {
    return { cause: "connection", statusCode };
  }
  return { cause: "temporary", statusCode };
}

