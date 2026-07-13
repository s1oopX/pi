import { useEffect, useRef, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useStreamingMessage } from "../../hooks/useStreamingMessage";
import { MessageBubble } from "../Message";
import type { Message } from "../../ipc/types";

const ESTIMATED_MESSAGE_HEIGHT = 80;

const MemoizedBubble = memo(function MemoizedBubble({ message }: { message: Message }) {
  return <MessageBubble message={message} />;
});

export function MessageList() {
  const { messages, isStreaming, streamingIndex } = useStreamingMessage();
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_MESSAGE_HEIGHT,
    overscan: 5,
  });

  useEffect(() => {
    if (!shouldAutoScroll.current || messages.length === 0) return;
    virtualizer.scrollToIndex(messages.length - 1, { align: "end", behavior: "smooth" });
  }, [messages.length, messages[messages.length - 1], virtualizer]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScroll.current = distanceFromBottom < 100;
  }

  if (messages.length === 0) {
    return (
      <div className="message-list-empty">
        <p className="placeholder-text">Send a message to get started.</p>
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
          const message = messages[virtualRow.index];
          const isStreamingRow = virtualRow.index === streamingIndex;
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
              {isStreamingRow ? (
                <MessageBubble message={message} />
              ) : (
                <MemoizedBubble message={message} />
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
