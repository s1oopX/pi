import { useStore } from "../../store";

export function StatusBar() {
  const session = useStore((s) => s.session);
  const stats = useStore((s) => s.stats);
  const isStreaming = useStore((s) => s.isStreaming);
  const activeTool = useStore((s) => s.activeTool);

  const tokensIn = stats?.tokens.input ?? 0;
  const tokensOut = stats?.tokens.output ?? 0;
  const cost = stats?.cost ?? 0;
  const messageCount = session?.messageCount ?? 0;
  const pendingCount = session?.pendingMessageCount ?? 0;

  return (
    <div className="status-bar" role="status" aria-live="polite">
      <div className="status-bar-left">
        {isStreaming && (
          <span className="status-streaming">
            <span className="status-streaming-dot" />
            {activeTool ? `Running ${activeTool}` : "Generating..."}
          </span>
        )}
        {!isStreaming && pendingCount > 0 && (
          <span className="status-pending">{pendingCount} pending</span>
        )}
      </div>
      <div className="status-bar-right">
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
