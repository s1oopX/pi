import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useI18n } from "../../i18n";
import { useStreamingMessage } from "../../hooks/useStreamingMessage";
import { MessageBubble } from "../Message";
import { getRetryErrorDisplay, RetryNotice } from "../RetryNotice";
import { ExtensionStatuses, sanitizeExtensionStatusText } from "../ExtensionStatuses";
import { StatusBar, hasStatusBarContent } from "../StatusBar";
import { EmptyState } from "./EmptyState";
import { computeToolPairing, type ToolPairing } from "./toolPairing";
import { useStore, type ToolExecutionsByCallId } from "../../store";
import type { RetryActivity } from "../../store/agentActivity";
import type { Message } from "../../ipc/types";
import { isMessageListNearBottom } from "./scrollState";

const ESTIMATED_MESSAGE_HEIGHT = 80;

type ResultsByCallId = ToolPairing["resultsByCallId"];
type QueuedConversationItem = { kind: "steer" | "follow-up"; message: string };

type Row =
  | { kind: "message"; message: Message; originalIndex: number; suppressError: boolean }
  | { kind: "retry"; activity: RetryActivity }
  | { kind: "status"; queued: QueuedConversationItem[]; extensionStatuses: Record<string, string> };

const MemoizedBubble = memo(function MemoizedBubble({
  message,
  suppressError,
  resultsByCallId,
  toolExecutionsByCallId,
}: {
  message: Message;
  suppressError: boolean;
  resultsByCallId: ResultsByCallId;
  toolExecutionsByCallId: ToolExecutionsByCallId;
}) {
  return (
    <MessageBubble
      message={message}
      suppressError={suppressError}
      resultsByCallId={resultsByCallId}
      toolExecutionsByCallId={toolExecutionsByCallId}
    />
  );
});

export function MessageList() {
  const { t } = useI18n();
  const { messages, isStreaming, streamingIndex } = useStreamingMessage();
  const session = useStore((state) => state.session);
  const stats = useStore((state) => state.stats);
  const sessionId = useStore((state) => state.session?.sessionId ?? null);
  const toolExecutionsByCallId = useStore((state) => state.toolExecutionsByCallId);
  const retryActivity = useStore((state) => state.retryActivity);
  const compactionActivity = useStore((state) => state.compactionActivity);
  const queuedSteering = useStore((state) => state.queuedSteering);
  const queuedFollowUp = useStore((state) => state.queuedFollowUp);
  const extensionStatuses = useStore((state) => state.extensionStatuses);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  // Pair standalone toolResult messages with their originating toolCall so they
  // can render inline in the tool card, and hide those standalone rows.
  const { resultsByCallId, hiddenIndices: hiddenToolResultIndices } = useMemo(
    () => computeToolPairing(messages),
    [messages],
  );
  const retryErrorDisplay = useMemo(
    () => getRetryErrorDisplay(messages, retryActivity !== null),
    [messages, retryActivity],
  );
  const queued = useMemo<QueuedConversationItem[]>(
    () => [
      ...queuedSteering.map((message) => ({ kind: "steer" as const, message })),
      ...queuedFollowUp.map((message) => ({ kind: "follow-up" as const, message })),
    ],
    [queuedSteering, queuedFollowUp],
  );
  const hasVisibleExtensionStatus = useMemo(
    () => Object.values(extensionStatuses).some((text) => sanitizeExtensionStatusText(text).length > 0),
    [extensionStatuses],
  );
  const hasConversationStatus = hasStatusBarContent({ session, stats, isStreaming, compactionActivity });

  useEffect(() => {
    shouldAutoScroll.current = true;
    setShowJumpToLatest(false);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }, [sessionId]);

  const rows = useMemo<Row[]>(() => {
    const messageRows: Row[] = messages
      .map((message, originalIndex) => ({
        kind: "message" as const,
        message,
        originalIndex,
        suppressError: retryErrorDisplay.suppressedErrorIndices.has(originalIndex),
      }))
      .filter((row) =>
        !hiddenToolResultIndices.has(row.originalIndex) &&
        !retryErrorDisplay.hiddenIndices.has(row.originalIndex)
      );
    const retryRows: Row[] = retryActivity ? [{ kind: "retry", activity: retryActivity }] : [];
    const statusRows: Row[] = hasConversationStatus || queued.length > 0 || hasVisibleExtensionStatus
      ? [{ kind: "status", queued, extensionStatuses }]
      : [];
    return [...messageRows, ...retryRows, ...statusRows];
  }, [
    messages,
    hiddenToolResultIndices,
    retryErrorDisplay,
    retryActivity,
    hasConversationStatus,
    queued,
    hasVisibleExtensionStatus,
    extensionStatuses,
  ]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_MESSAGE_HEIGHT,
    getItemKey: (index) => {
      const row = rows[index];
      if (row.kind === "message") return `message:${row.originalIndex}`;
      if (row.kind === "retry") return `retry:${row.activity.startedAt}`;
      return "status";
    },
    overscan: 5,
  });

  useEffect(() => {
    if (!shouldAutoScroll.current || rows.length === 0) return;
    setShowJumpToLatest(false);
    virtualizer.scrollToIndex(rows.length - 1, { align: "end", behavior: isStreaming ? "auto" : "smooth" });
  }, [
    rows.length,
    messages[messages.length - 1],
    isStreaming,
    retryActivity?.startedAt,
    virtualizer,
  ]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = isMessageListNearBottom(el);
    shouldAutoScroll.current = nearBottom;
    setShowJumpToLatest(!nearBottom);
  }

  function jumpToLatest() {
    shouldAutoScroll.current = true;
    setShowJumpToLatest(false);
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }

  if (rows.length === 0) {
    return (
      <div className="message-list-empty">
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="message-list-container">
      <div
        ref={scrollRef}
        className="message-list-scroll"
        onScroll={handleScroll}
      >
        <div
          className="message-list-inner"
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className="message-list-row"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {row.kind === "status" ? (
                  <ConversationStatus queued={row.queued} extensionStatuses={row.extensionStatuses} />
                ) : row.kind === "retry" ? (
                  <RetryNotice activity={row.activity} />
                ) : row.originalIndex === streamingIndex ? (
                  <MessageBubble
                    message={row.message}
                    suppressError={row.suppressError}
                    resultsByCallId={resultsByCallId}
                    toolExecutionsByCallId={toolExecutionsByCallId}
                    streaming
                  />
                ) : (
                  <MemoizedBubble
                    message={row.message}
                    suppressError={row.suppressError}
                    resultsByCallId={resultsByCallId}
                    toolExecutionsByCallId={toolExecutionsByCallId}
                  />
                )}
              </div>
            );
          })}
        </div>
        {isStreaming && (
          <div
            className="streaming-indicator"
            aria-live="polite"
            aria-label={t("Working…", "正在处理…")}
          >
            <span className="streaming-dot" />
            <span className="streaming-dot" />
            <span className="streaming-dot" />
          </div>
        )}
      </div>
      {showJumpToLatest && (
        <button className="message-list-jump-latest" type="button" onClick={jumpToLatest}>
          <svg viewBox="0 0 18 18" aria-hidden="true">
            <path d="m5 7 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{t("Jump to latest", "跳转到最新消息")}</span>
        </button>
      )}
    </div>
  );
}

function ConversationStatus({
  queued,
  extensionStatuses,
}: {
  queued: readonly QueuedConversationItem[];
  extensionStatuses: Readonly<Record<string, string>>;
}) {
  const { t } = useI18n();

  return (
    <div className="conversation-status-panel">
      <StatusBar />
      {queued.length > 0 && (
        <div className="conversation-queue" aria-label={t("Queued messages", "已排队的消息")}>
          {queued.map((item, index) => (
            <div className="conversation-queue-item" key={`${item.kind}:${index}`} title={item.message}>
              <span className="conversation-queue-badge">
                {item.kind === "steer" ? t("steer", "引导") : t("follow-up", "跟进")}
              </span>
              <span className="conversation-queue-text">{item.message}</span>
            </div>
          ))}
        </div>
      )}
      <ExtensionStatuses statuses={extensionStatuses} />
    </div>
  );
}
