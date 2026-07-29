import { useI18n } from "../../i18n";
import type { RetryActivity } from "../../store/agentActivity";
import { classifyRetryError } from "./retryPresentation";

export function RetryNotice({ activity }: { activity: RetryActivity }) {
  const { t } = useI18n();
  const { cause } = classifyRetryError(activity.errorMessage);
  const label = cause === "rate-limit" || cause === "server"
    ? t(
        "Server is busy, reconnecting {attempt}/{maxAttempts}",
        "服务繁忙，正在重新连接 {attempt}/{maxAttempts}",
        {
          attempt: activity.attempt,
          maxAttempts: activity.maxAttempts,
        },
      )
    : t("Reconnecting {attempt}/{maxAttempts}", "正在重新连接 {attempt}/{maxAttempts}", {
        attempt: activity.attempt,
        maxAttempts: activity.maxAttempts,
      });

  return (
    <div className="retry-notice" role="status" aria-live="polite" title={activity.errorMessage}>
      <span className="retry-notice-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
