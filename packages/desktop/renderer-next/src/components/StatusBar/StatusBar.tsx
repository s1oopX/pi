import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { useElapsedSeconds } from "../../hooks/useElapsedSeconds";
import { useStore } from "../../store";
import type { SessionState, SessionStats } from "../../ipc/types";
import type { CompactionActivity } from "../../store/agentActivity";

interface StatusBarContentSnapshot {
  session: SessionState | null;
  stats: SessionStats | undefined;
  isStreaming: boolean;
  compactionActivity: CompactionActivity | null;
}

export function hasStatusBarContent({
  session,
  stats,
  isStreaming,
  compactionActivity,
}: StatusBarContentSnapshot): boolean {
  const tokensIn = stats?.tokens.input ?? 0;
  const tokensOut = stats?.tokens.output ?? 0;
  const cost = stats?.cost ?? 0;
  const messageCount = session?.messageCount ?? 0;
  const pendingCount = session?.pendingMessageCount ?? 0;
  const hasStats = messageCount > 0 || tokensIn > 0 || tokensOut > 0 || cost > 0;
  const isCompacting = compactionActivity !== null || Boolean(session?.isCompacting);
  return isStreaming || isCompacting || pendingCount > 0 || hasStats;
}

export function StatusBar() {
  const { t } = useI18n();
  const session = useStore((state) => state.session);
  const stats = useStore((state) => state.stats);
  const isStreaming = useStore((state) => state.isStreaming);
  const activeTool = useStore((state) => state.activeTool);
  const compactionActivity = useStore((state) => state.compactionActivity);
  const elapsedSeconds = useElapsedSeconds(isStreaming);
  const [statsOpen, setStatsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const tokensIn = stats?.tokens.input ?? 0;
  const tokensOut = stats?.tokens.output ?? 0;
  const cost = stats?.cost ?? 0;
  const messageCount = session?.messageCount ?? 0;
  const pendingCount = session?.pendingMessageCount ?? 0;
  const contextUsage = stats?.contextUsage;
  const contextPercent =
    contextUsage && contextUsage.percent !== null ? Math.min(100, Math.max(0, contextUsage.percent)) : null;
  const hasStats = messageCount > 0 || tokensIn > 0 || tokensOut > 0 || cost > 0;
  const isCompacting = compactionActivity !== null || Boolean(session?.isCompacting);
  const compactionLabel =
    compactionActivity?.reason === "threshold"
      ? t("Auto-compacting context", "正在自动压缩上下文")
      : compactionActivity?.reason === "overflow"
        ? t("Recovering context", "正在恢复上下文")
        : t("Compacting context", "正在压缩上下文");
  const elapsedLabel = elapsedSeconds < 60
    ? t("{seconds}s", "{seconds} 秒", { seconds: elapsedSeconds })
    : t("{minutes}m {seconds}s", "{minutes} 分 {seconds} 秒", {
        minutes: Math.floor(elapsedSeconds / 60),
        seconds: elapsedSeconds % 60,
      });

  useEffect(() => {
    if (!statsOpen) return;
    popoverRef.current?.focus();

    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setStatsOpen(false);
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setStatsOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [statsOpen]);

  if (!hasStatusBarContent({ session, stats, isStreaming, compactionActivity })) return null;

  const contextTone = contextPercent !== null && contextPercent >= 90 ? "critical" : contextPercent !== null && contextPercent >= 70 ? "warn" : "";

  return (
    <div className="session-status" ref={rootRef}>
      {(isCompacting || isStreaming) && (
        <span
          className={`status-streaming${isCompacting ? " status-compacting" : ""}`}
          role="status"
          aria-live="polite"
        >
          <span className="status-streaming-dot" aria-hidden="true" />
          <span className="status-streaming-label">
            {isCompacting
              ? compactionLabel
              : activeTool
                ? t("Running {tool}", "正在运行 {tool}", { tool: activeTool })
                : t("Generating", "正在生成")}
          </span>
          {!isCompacting && elapsedSeconds > 0 && (
            <span className="status-elapsed">{elapsedLabel}</span>
          )}
        </span>
      )}
      {!isStreaming && !isCompacting && pendingCount > 0 && (
        <span className="status-pending" role="status" aria-live="polite">
          {t("{count} pending", "{count} 条待处理", { count: pendingCount })}
        </span>
      )}

      {hasStats && (
        <div className="status-summary">
          <button
            ref={triggerRef}
            className={`status-summary-trigger ${contextTone}`}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={statsOpen}
            aria-controls="session-stats-popover"
            onClick={() => setStatsOpen((open) => !open)}
          >
            {contextPercent !== null && (
              <span>{t("Context {percent}%", "上下文 {percent}%", { percent: Math.round(contextPercent) })}</span>
            )}
            {contextPercent !== null && messageCount > 0 && <span className="status-summary-separator">·</span>}
            {messageCount > 0 && (
              <span>
                {messageCount === 1
                  ? t("{count} msg", "{count} 条消息", { count: messageCount })
                  : t("{count} msgs", "{count} 条消息", { count: messageCount })}
              </span>
            )}
            {contextPercent === null && messageCount === 0 && (
              <span>{t("Session stats", "会话统计")}</span>
            )}
            <svg className="status-summary-chevron" viewBox="0 0 16 16" aria-hidden="true">
              <path d="m5 6 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {statsOpen && (
            <div
              ref={popoverRef}
              id="session-stats-popover"
              className="status-popover"
              role="dialog"
              aria-labelledby="session-stats-title"
              tabIndex={-1}
            >
              <div id="session-stats-title" className="status-popover-title">
                {t("Session usage", "会话用量")}
              </div>
              {contextPercent !== null && contextUsage && (
                <div className="status-popover-section">
                  <div className="status-popover-row">
                    <span>{t("Context", "上下文")}</span>
                    <span>
                      {contextUsage.tokens?.toLocaleString() ?? "?"} / {contextUsage.contextWindow.toLocaleString()}
                    </span>
                  </div>
                  <span className={`context-usage-track ${contextTone}`}>
                    <span className="context-usage-fill" style={{ width: `${contextPercent}%` }} />
                  </span>
                </div>
              )}
              {messageCount > 0 && (
                <div className="status-popover-row">
                  <span>{t("Messages", "消息")}</span>
                  <span>{messageCount.toLocaleString()}</span>
                </div>
              )}
              {(tokensIn > 0 || tokensOut > 0) && (
                <div className="status-popover-row">
                  <span>{t("Tokens", "令牌")}</span>
                  <span title={t("Input {input}, output {output}", "输入 {input}，输出 {output}", {
                    input: tokensIn.toLocaleString(),
                    output: tokensOut.toLocaleString(),
                  })}>
                    {t("{input} in · {output} out", "输入 {input} · 输出 {output}", {
                      input: formatTokens(tokensIn),
                      output: formatTokens(tokensOut),
                    })}
                  </span>
                </div>
              )}
              {cost > 0 && (
                <div className="status-popover-row">
                  <span>{t("Cost", "费用")}</span>
                  <span>${cost.toFixed(4)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}
