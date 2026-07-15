import { useEffect, useRef, useState } from "react";
import { useStore } from "../../store";

// Tracks elapsed seconds since streaming began, resetting when it stops.
function useElapsedSeconds(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);
  useEffect(() => {
    if (!active) {
      startedAt.current = null;
      setElapsed(0);
      return;
    }
    startedAt.current = Date.now();
    setElapsed(0);
    const timer = setInterval(() => {
      if (startedAt.current != null) {
        setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [active]);
  return elapsed;
}

export function StatusBar() {
  const session = useStore((s) => s.session);
  const stats = useStore((s) => s.stats);
  const isStreaming = useStore((s) => s.isStreaming);
  const activeTool = useStore((s) => s.activeTool);
  const elapsedSeconds = useElapsedSeconds(isStreaming);

  const tokensIn = stats?.tokens.input ?? 0;
  const tokensOut = stats?.tokens.output ?? 0;
  const cost = stats?.cost ?? 0;
  const messageCount = session?.messageCount ?? 0;
  const pendingCount = session?.pendingMessageCount ?? 0;

  const contextUsage = stats?.contextUsage;
  const contextPercent =
    contextUsage && contextUsage.percent !== null ? Math.min(100, Math.max(0, contextUsage.percent)) : null;

  return (
    <div className="status-bar" role="status" aria-live="polite">
      <div className="status-bar-left">
        {isStreaming && (
          <span className="status-streaming">
            <span className="status-streaming-dot" />
            {activeTool ? `Running ${activeTool}` : "Generating..."}
            {elapsedSeconds > 0 && <span className="status-elapsed"> ({formatElapsed(elapsedSeconds)})</span>}
          </span>
        )}
        {!isStreaming && pendingCount > 0 && (
          <span className="status-pending">{pendingCount} pending</span>
        )}
      </div>
      <div className="status-bar-right">
        {contextPercent !== null && contextUsage && (
          <span
            className={`context-usage ${contextPercent >= 90 ? "critical" : contextPercent >= 70 ? "warn" : ""}`}
            title={`Context: ${contextUsage.tokens?.toLocaleString() ?? "?"} / ${contextUsage.contextWindow.toLocaleString()} tokens`}
          >
            <span className="context-usage-track">
              <span className="context-usage-fill" style={{ width: `${contextPercent}%` }} />
            </span>
            <span className="context-usage-label">{Math.round(contextPercent)}%</span>
          </span>
        )}
        {messageCount > 0 && (
          <span className="status-item" title="Messages">
            {messageCount} msg{messageCount !== 1 ? "s" : ""}
          </span>
        )}
        {(tokensIn > 0 || tokensOut > 0) && (
          <span className="status-item" title={`In: ${tokensIn.toLocaleString()} / Out: ${tokensOut.toLocaleString()}`}>
            {formatTokens(tokensIn + tokensOut)} tokens
          </span>
        )}
        {cost > 0 && (
          <span className="status-item" title="Session cost">
            ${cost.toFixed(4)}
          </span>
        )}
      </div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${minutes}m ${rem}s`;
}
