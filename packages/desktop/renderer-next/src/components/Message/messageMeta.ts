import { translateText, type ResolvedLanguage } from "../../i18n";
import type { Message } from "../../ipc/types";

export interface MessageMeta {
  /** Compact token readout, e.g. "1.2k tokens" or "820 tokens". */
  tokens?: string;
  /** Formatted cost, e.g. "$0.0123", omitted when zero/unknown. */
  cost?: string;
  /** Model that produced the response (responseModel preferred over request model). */
  model?: string;
  /** Localized wall-clock time the response finished, e.g. "14:32". */
  time?: string;
  /** Single-line label joining the available parts with " · ". */
  line: string;
}

function formatTokenCount(total: number): string {
  if (total < 1000) return String(total);
  const thousands = total / 1000;
  // One decimal below 10k (1.2k), whole thousands above (24k).
  return thousands < 10 ? `${thousands.toFixed(1)}k` : `${Math.round(thousands)}k`;
}

function formatCost(total: number): string | undefined {
  if (!Number.isFinite(total) || total <= 0) return undefined;
  // Sub-cent costs still matter at scale; show enough precision to be non-zero.
  if (total < 0.01) return `$${total.toFixed(4)}`;
  return `$${total.toFixed(total < 1 ? 3 : 2)}`;
}

function formatClockTime(timestamp: number): string | undefined {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return undefined;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return undefined;
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Derives a compact metadata readout for a finalized assistant turn: token
 * usage, cost, model, and completion time. Presentation-only; returns empty
 * parts when the wire message lacks the underlying fields (e.g. an aborted or
 * error turn with zero usage). Non-assistant roles produce an empty line.
 */
export function formatMessageMeta(message: Message, language: ResolvedLanguage): MessageMeta {
  if (message.role !== "assistant") return { line: "" };

  const totalTokens = message.usage.totalTokens > 0
    ? message.usage.totalTokens
    : message.usage.input + message.usage.output;
  const tokens = totalTokens > 0
    ? translateText(language, "{count} tokens", "{count} tokens", { count: formatTokenCount(totalTokens) })
    : undefined;
  const cost = formatCost(message.usage.cost.total);
  const model = message.responseModel?.trim() || message.model?.trim() || undefined;
  const time = formatClockTime(message.timestamp);

  const line = [tokens, cost, model, time].filter(Boolean).join(" · ");
  return { tokens, cost, model, time, line };
}
