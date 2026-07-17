import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import * as api from "../../ipc/api";
import type { RetryActivity } from "../../store/agentActivity";
import { showToast } from "../Toast";
import { classifyRetryError } from "./retryPresentation";

function getRemainingSeconds(activity: RetryActivity): number {
  return Math.max(0, Math.ceil((activity.startedAt + activity.delayMs - Date.now()) / 1000));
}

export function RetryNotice({ activity }: { activity: RetryActivity }) {
  const { t } = useI18n();
  const [remainingSeconds, setRemainingSeconds] = useState(() => getRemainingSeconds(activity));
  const [cancelling, setCancelling] = useState(false);
  const { cause, statusCode } = classifyRetryError(activity.errorMessage);

  useEffect(() => {
    const update = () => setRemainingSeconds(getRemainingSeconds(activity));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [activity]);

  const statusSuffix = statusCode === null ? "" : ` (${statusCode})`;
  const causeLabel = cause === "rate-limit"
    ? t("Rate limit reached", "请求过于频繁")
    : cause === "server"
      ? t("Service temporarily unavailable", "服务暂时不可用")
      : cause === "connection"
        ? t("Connection interrupted", "连接暂时中断")
        : t("Temporary model error", "模型服务暂时出错");
  const title = remainingSeconds > 0
    ? t(
        "Connection interrupted. Retrying in {seconds}s ({attempt}/{maxAttempts})",
        "连接中断，{seconds} 秒后重试（{attempt}/{maxAttempts}）",
        {
          seconds: remainingSeconds,
          attempt: activity.attempt,
          maxAttempts: activity.maxAttempts,
        },
      )
    : t("Retrying ({attempt}/{maxAttempts})", "正在重试（{attempt}/{maxAttempts}）", {
        attempt: activity.attempt,
        maxAttempts: activity.maxAttempts,
      });

  async function handleCancel() {
    setCancelling(true);
    try {
      await api.abortRetry();
    } catch (error) {
      setCancelling(false);
      showToast(t("Failed to cancel retry: {error}", "取消重试失败：{error}", {
        error: error instanceof Error ? error.message : String(error),
      }), "error");
    }
  }

  return (
    <div className="retry-notice" role="status" aria-live="polite" title={activity.errorMessage}>
      <span className="retry-notice-spinner" aria-hidden="true" />
      <span className="retry-notice-copy">
        <strong>{title}</strong>
        <span>{causeLabel}{statusSuffix}</span>
      </span>
      <button className="retry-notice-cancel" type="button" disabled={cancelling} onClick={handleCancel}>
        {cancelling ? t("Cancelling…", "正在取消……") : t("Cancel", "取消")}
      </button>
    </div>
  );
}

