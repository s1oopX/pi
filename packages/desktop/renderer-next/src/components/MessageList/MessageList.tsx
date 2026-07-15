import { useEffect, useMemo, useRef, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useStreamingMessage } from "../../hooks/useStreamingMessage";
import { MessageBubble, InlineApproval } from "../Message";
import { EmptyState } from "./EmptyState";
import { computeToolPairing, type ToolPairing } from "./toolPairing";
import { useStore } from "../../store";
import type { ExtensionUIRequestEvent, Message } from "../../ipc/types";

const ESTIMATED_MESSAGE_HEIGHT = 80;

type ResultsByCallId = ToolPairing["resultsByCallId"];

// A row in the virtualized list is either a real conversation message or a
// pending approval request. Approval rows live outside the messages array (in
// extensionUIRequests) so they survive the getMessages() refresh that overwrites
// messages, and are appended after all messages since the tool call that
// triggered them is always at the current stream tail.
type Row =
  | { kind: "message"; message: Message; originalIndex: number }
  | { kind: "approval"; request: ExtensionUIRequestEvent };

const MemoizedBubble = memo(function MemoizedBubble({
  message,
  resultsByCallId,
}: {
  message: Message;
  resultsByCallId: ResultsByCallId;
}) {
  return <MessageBubble message={message} resultsByCallId={resultsByCallId} />;
});

export function MessageList() {
  const { messages, isStreaming, streamingIndex } = useStreamingMessage();
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  // Pair standalone toolResult messages with their originating toolCall so they
  // can render inline in the tool card, and hide those standalone rows.
  const { resultsByCallId, hiddenIndices } = useMemo(() => computeToolPairing(messages), [messages]);

  // Only confirm/select requests are interactive approvals; other methods
  // (notify, setStatus, ...) are fire-and-forget side effects with no card.
  const extensionUIRequests = useStore((s) => s.extensionUIRequests);
  const approvals = useMemo(
    () => extensionUIRequests.filter((r) => r.method === "confirm" || r.method === "select"),
    [extensionUIRequests],
  );

  // Merge conversation messages (minus paired toolResults) with pending approval
  // cards. Approvals go last since the suspended tool call is at the stream tail.
  const rows = useMemo<Row[]>(() => {
    const messageRows: Row[] = messages
      .map((message, originalIndex) => ({ kind: "message" as const, message, originalIndex }))
      .filter((row) => !hiddenIndices.has(row.originalIndex));
    const approvalRows: Row[] = approvals.map((request) => ({ kind: "approval" as const, request }));
    return [...messageRows, ...approvalRows];
  }, [messages, hiddenIndices, approvals]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_MESSAGE_HEIGHT,
    overscan: 5,
  });

  useEffect(() => {
    if (!shouldAutoScroll.current || rows.length === 0) return;
    virtualizer.scrollToIndex(rows.length - 1, { align: "end", behavior: "smooth" });
  }, [rows.length, messages[messages.length - 1], virtualizer]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScroll.current = distanceFromBottom < 100;
  }

  if (messages.length === 0) {
    return (
      <div className="message-list-empty">
        <EmptyState />
      </div>
    );
  }

  return (
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
              {row.kind === "approval" ? (
                <InlineApproval request={row.request} />
              ) : row.originalIndex === streamingIndex ? (
                <MessageBubble message={row.message} resultsByCallId={resultsByCallId} streaming />
              ) : (
                <MemoizedBubble message={row.message} resultsByCallId={resultsByCallId} />
              )}
            </div>
          );
        })}
      </div>
      {isStreaming && (
        <div className="streaming-indicator" aria-live="polite" aria-label="Generating response">
          <span className="streaming-dot" />
          <span className="streaming-dot" />
          <span className="streaming-dot" />
        </div>
      )}
    </div>
  );
}
