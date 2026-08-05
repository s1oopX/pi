import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { useElapsedSeconds } from "../../hooks/useElapsedSeconds";
import { useStore } from "../../store";

// Codex-style context meter that lives in the composer footer beside the model
// picker: a quiet gauge of context-window usage that turns into a spinner while
// the agent runs, and reveals a token-usage card on hover / focus.
export function ContextMeter() {
  const { t } = useI18n();
  const session = useStore((state) => state.session);
  const stats = useStore((state) => state.stats);
  const isStreaming = useStore((state) => state.isStreaming);
  const activeTool = useStore((state) => state.activeTool);
  const compactionActivity = useStore((state) => state.compactionActivity);
  const workspaceLoading = useStore((state) => state.workspaceLoading);
  const elapsedSeconds = useElapsedSeconds(isStreaming);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();

  function closePopover(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  const tokensIn = stats?.tokens.input ?? 0;
  const tokensOut = stats?.tokens.output ?? 0;
  const cost = stats?.cost ?? 0;
  const messageCount = session?.messageCount ?? 0;
  const contextUsage = stats?.contextUsage;
  const contextPercent =
    contextUsage && contextUsage.percent !== null
      ? Math.min(100, Math.max(0, contextUsage.percent))
      : null;
  const isCompacting = compactionActivity !== null || Boolean(session?.isCompacting);
  const hasStats = messageCount > 0 || tokensIn > 0 || tokensOut > 0 || cost > 0;

  const active = isStreaming || isCompacting;
  const visible = !workspaceLoading && (active || hasStats);

  useEffect(() => {
    if (!open) return;
    if (!visible) {
      setOpen(false);
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closePopover(true);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, visible]);

  if (!visible) return null;

  const tone = contextPercent !== null && contextPercent >= 90
    ? "critical"
    : contextPercent !== null && contextPercent >= 70
      ? "warn"
      : "";

  const compactionLabel =
    compactionActivity?.reason === "threshold"
      ? t("Auto-compacting", "正在自动压缩")
      : compactionActivity?.reason === "overflow"
        ? t("Recovering context", "正在恢复上下文")
        : t("Compacting", "正在压缩");
  const runningLabel = isCompacting
    ? compactionLabel
    : activeTool
      ? t("Running {tool}", "正在运行 {tool}", { tool: activeTool })
      : t("Generating", "正在生成");
  const elapsedLabel = elapsedSeconds < 60
    ? t("{seconds}s", "{seconds} 秒", { seconds: elapsedSeconds })
    : t("{minutes}m {seconds}s", "{minutes} 分 {seconds} 秒", {
        minutes: Math.floor(elapsedSeconds / 60),
        seconds: elapsedSeconds % 60,
      });

  // The pill's primary readout: a spinner + label while running, otherwise the
  // context percentage (or a neutral fallback when the window size is unknown).
  const percentLabel = contextPercent !== null
    ? t("{percent}%", "{percent}%", { percent: Math.round(contextPercent) })
    : t("Usage", "用量");
  const triggerLabel = active
    ? runningLabel
    : contextPercent !== null
      ? t("Context {percent}% used", "上下文已用 {percent}%", { percent: Math.round(contextPercent) })
      : t("Context usage", "上下文用量");

  const circumference = 2 * Math.PI * 6;
  const dashOffset = contextPercent !== null
    ? circumference * (1 - contextPercent / 100)
    : circumference;

  return (
    <div
      className="context-meter"
      ref={rootRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`context-meter-trigger ${tone}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-label={triggerLabel}
        onFocus={() => setOpen(true)}
        onBlur={(event) => {
          if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return;
          setOpen(false);
        }}
        onClick={() => setOpen(true)}
      >
        {active ? (
          <>
            <span className="context-meter-spinner" aria-hidden="true" />
            <span className="context-meter-run-label">{runningLabel}</span>
            {!isCompacting && elapsedSeconds > 0 && (
              <span className="context-meter-elapsed">{elapsedLabel}</span>
            )}
          </>
        ) : (
          <>
            <svg className="context-meter-ring" viewBox="0 0 16 16" aria-hidden="true">
              <circle className="context-meter-ring-track" cx="8" cy="8" r="6" fill="none" strokeWidth="2" />
              {contextPercent !== null && (
                <circle
                  className="context-meter-ring-fill"
                  cx="8"
                  cy="8"
                  r="6"
                  fill="none"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  transform="rotate(-90 8 8)"
                />
              )}
            </svg>
            {hasStats && <span className="context-meter-value">{percentLabel}</span>}
          </>
        )}
      </button>

      {open && (
        <div
          id={popoverId}
          className="context-meter-popover"
          role="dialog"
          aria-label={t("Context usage", "上下文用量")}
        >
          <div className="context-meter-popover-title">{t("Context window:", "背景信息窗口：")}</div>
          <div className="context-meter-popover-usage">
            {contextPercent !== null
              ? t("{percent}% used", "{percent}% 已用", { percent: Math.round(contextPercent) })
              : t("Usage unavailable", "用量未知")}
          </div>
          {contextUsage && (
            <div className="context-meter-popover-tokens">
              {t("{used} tokens used, {total} total", "已用 {used} 标记，共 {total}", {
                used: formatTokens(contextUsage.tokens ?? 0),
                total: formatTokens(contextUsage.contextWindow),
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".0", "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(".0", "")}k`;
  return String(value);
}
