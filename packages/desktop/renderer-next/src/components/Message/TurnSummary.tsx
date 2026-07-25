import { useMemo } from "react";
import { translateText, type ResolvedLanguage } from "../../i18n";
import type { Message, ToolCall } from "../../ipc/types";

type AssistantMessage = Extract<Message, { role: "assistant" }>;

interface TurnSummaryProps {
  message: AssistantMessage;
  language: ResolvedLanguage;
}

interface TurnStats {
  fileEdits: number;
  fileWrites: number;
  commands: number;
  searches: number;
  reads: number;
  other: number;
}

function countToolOps(content: AssistantMessage["content"]): TurnStats {
  const stats: TurnStats = { fileEdits: 0, fileWrites: 0, commands: 0, searches: 0, reads: 0, other: 0 };
  for (const block of content) {
    if (block.type !== "toolCall") continue;
    const call = block as ToolCall;
    switch (call.name) {
      case "edit":
        stats.fileEdits++;
        break;
      case "write":
        stats.fileWrites++;
        break;
      case "bash":
        stats.commands++;
        break;
      case "grep":
      case "find":
      case "ls":
        stats.searches++;
        break;
      case "read":
        stats.reads++;
        break;
      default:
        stats.other++;
        break;
    }
  }
  return stats;
}

function formatTurnSummary(stats: TurnStats, language: ResolvedLanguage): string | null {
  const parts: string[] = [];
  const t = (en: string, zh: string) => translateText(language, en, zh);
  const filesChanged = stats.fileEdits + stats.fileWrites;
  if (filesChanged > 0) {
    parts.push(
      filesChanged === 1
        ? t("1 file changed", "更改了 1 个文件")
        : t(`${filesChanged} files changed`, `更改了 ${filesChanged} 个文件`),
    );
  }
  if (stats.commands > 0) {
    parts.push(
      stats.commands === 1
        ? t("1 command", "1 条命令")
        : t(`${stats.commands} commands`, `${stats.commands} 条命令`),
    );
  }
  if (stats.searches > 0) {
    parts.push(
      stats.searches === 1
        ? t("1 search", "1 次搜索")
        : t(`${stats.searches} searches`, `${stats.searches} 次搜索`),
    );
  }
  if (stats.reads > 0) {
    parts.push(
      stats.reads === 1
        ? t("1 file read", "读取了 1 个文件")
        : t(`${stats.reads} files read`, `读取了 ${stats.reads} 个文件`),
    );
  }
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

export function TurnSummary({ message, language }: TurnSummaryProps) {
  const summary = useMemo(
    () => formatTurnSummary(countToolOps(message.content), language),
    [message.content, language],
  );
  if (!summary) return null;
  return (
    <div className="turn-summary">
      <span className="turn-summary-text">{summary}</span>
    </div>
  );
}
