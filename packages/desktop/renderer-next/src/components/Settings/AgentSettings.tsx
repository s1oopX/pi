import { useState } from "react";
import { useI18n } from "../../i18n";
import * as api from "../../ipc/api";
import type { QueueMode, ThinkingLevel } from "../../ipc/types";
import { useStore, type PermissionMode } from "../../store";
import { PERMISSION_MODE_OPTIONS } from "../PermissionSelector/permissionModes";
import { showToast } from "../Toast";

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
const QUEUE_MODES: QueueMode[] = ["all", "one-at-a-time"];

export function AgentSettings() {
  const session = useStore((state) => state.session);
  const isStreaming = useStore((state) => state.isStreaming);
  const retryActivity = useStore((state) => state.retryActivity);
  const compactionActivity = useStore((state) => state.compactionActivity);
  const permissionMode = useStore((state) => state.permissionMode);
  const setPermissionMode = useStore((state) => state.setPermissionMode);
  const { t } = useI18n();
  const [pendingSetting, setPendingSetting] = useState<"auto-compaction" | "auto-retry" | null>(null);
  const [manualCompactPending, setManualCompactPending] = useState(false);
  const thinkingLevel = (session?.thinkingLevel ?? "medium") as ThinkingLevel;
  const steeringMode = (session?.steeringMode ?? "all") as QueueMode;
  const followUpMode = (session?.followUpMode ?? "all") as QueueMode;
  const autoCompaction = session?.autoCompactionEnabled ?? true;
  const autoRetry = session?.autoRetryEnabled ?? true;

  function permissionLabel(mode: PermissionMode): string {
    if (mode === "full") return t("Full access", "完全访问");
    if (mode === "auto") return t("Auto approve", "自动批准");
    return t("Ask every time", "每次询问");
  }

  function permissionDescription(mode: PermissionMode): string {
    if (mode === "full") return t("Run all tool actions without asking.", "无需询问即可运行所有工具操作。");
    if (mode === "auto") return t("Ask only for potentially risky operations.", "仅对可能有风险的操作进行询问。");
    return t("Ask before commands or file changes.", "运行命令或更改文件前询问。");
  }

  function thinkingLabel(level: ThinkingLevel): string {
    if (level === "off") return t("Off", "关闭");
    if (level === "minimal") return t("Minimal", "最少");
    if (level === "low") return t("Low", "低");
    if (level === "medium") return t("Medium", "中");
    if (level === "high") return t("High", "高");
    return t("Maximum", "最高");
  }

  function queueModeLabel(mode: QueueMode): string {
    return mode === "all" ? t("Process all at once", "一次处理全部") : t("One at a time", "一次处理一条");
  }

  async function refreshAuthoritativeSession(): Promise<void> {
    const nextSession = await api.getState();
    useStore.setState({ session: nextSession, isStreaming: nextSession.isStreaming });
  }

  async function handleThinking(level: ThinkingLevel) {
    try {
      await api.setThinkingLevel(level);
      useStore.getState().refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("Failed: {message}", "失败：{message}", { message }), "error");
    }
  }

  async function handleSteeringMode(mode: QueueMode) {
    try {
      await api.setSteeringMode(mode);
      useStore.getState().refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("Failed: {message}", "失败：{message}", { message }), "error");
    }
  }

  async function handleFollowUpMode(mode: QueueMode) {
    try {
      await api.setFollowUpMode(mode);
      useStore.getState().refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("Failed: {message}", "失败：{message}", { message }), "error");
    }
  }

  async function handleAutoCompaction(enabled: boolean) {
    setPendingSetting("auto-compaction");
    try {
      await api.setAutoCompaction(enabled);
      await refreshAuthoritativeSession();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("Failed: {message}", "失败：{message}", { message }), "error");
    } finally {
      setPendingSetting(null);
    }
  }

  async function handleAutoRetry(enabled: boolean) {
    setPendingSetting("auto-retry");
    try {
      await api.setAutoRetry(enabled);
      await refreshAuthoritativeSession();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("Failed: {message}", "失败：{message}", { message }), "error");
    } finally {
      setPendingSetting(null);
    }
  }

  async function handleManualCompact() {
    setManualCompactPending(true);
    try {
      await api.compact();
      useStore.getState().refresh();
      showToast(t("Context compacted", "上下文已压缩"), "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("Compaction failed: {message}", "压缩失败：{message}", { message }), "error");
    } finally {
      setManualCompactPending(false);
    }
  }

  const compacting = manualCompactPending || Boolean(session?.isCompacting) || compactionActivity !== null;
  const manualCompactDisabled =
    !session?.model ||
    session.messageCount < 2 ||
    isStreaming ||
    Boolean(session.isRetrying) ||
    retryActivity !== null ||
    compacting;

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t("Agent Settings", "智能体设置")}</h3>

      <div className="settings-group">
        <span className="settings-group-label">{t("Tool Permissions", "工具权限")}</span>
        <p className="settings-group-desc">
          {t("Choose when the agent asks before running commands or changing files.", "选择智能体在运行命令或更改文件前何时询问。")}
        </p>
        <div className="settings-radio-group">
          {PERMISSION_MODE_OPTIONS.map((option) => (
            <label key={option.mode} className="settings-radio-option">
              <input
                type="radio"
                name="permission-mode"
                value={option.mode}
                checked={permissionMode === option.mode}
                onChange={() => setPermissionMode(option.mode)}
              />
              <span>{permissionLabel(option.mode)} — {permissionDescription(option.mode)}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="settings-group">
        <span className="settings-group-label">{t("Thinking Level", "思考级别")}</span>
        <p className="settings-group-desc">{t("Controls how much reasoning the model uses.", "控制模型使用的推理量。")}</p>
        <div className="settings-radio-group">
          {THINKING_LEVELS.map((level) => (
            <label key={level} className="settings-radio-option">
              <input
                type="radio"
                name="thinking-level"
                value={level}
                checked={thinkingLevel === level}
                onChange={() => handleThinking(level)}
              />
              <span>{thinkingLabel(level)}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="settings-group">
        <span className="settings-group-label">{t("Steering Mode", "引导消息模式")}</span>
        <p className="settings-group-desc">
          {t("How steering messages are processed while the agent runs.", "智能体运行时如何处理引导消息。")}
        </p>
        <select className="form-select" value={steeringMode} onChange={(event) => handleSteeringMode(event.target.value as QueueMode)}>
          {QUEUE_MODES.map((mode) => <option key={mode} value={mode}>{queueModeLabel(mode)}</option>)}
        </select>
      </div>

      <div className="settings-group">
        <span className="settings-group-label">{t("Follow-up Mode", "跟进消息模式")}</span>
        <p className="settings-group-desc">
          {t("How follow-up messages are dispatched after a turn completes.", "一轮完成后如何发送跟进消息。")}
        </p>
        <select className="form-select" value={followUpMode} onChange={(event) => handleFollowUpMode(event.target.value as QueueMode)}>
          {QUEUE_MODES.map((mode) => <option key={mode} value={mode}>{queueModeLabel(mode)}</option>)}
        </select>
      </div>

      <div className="settings-group">
        <span className="settings-group-label">{t("Auto Retry", "自动重试")}</span>
        <p className="settings-group-desc">
          {t("Retry transient rate limits, overloads, and server errors automatically.", "自动重试临时限流、过载和服务器错误。")}
        </p>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={autoRetry}
            disabled={!session || pendingSetting !== null}
            onChange={(event) => handleAutoRetry(event.target.checked)}
          />
          <span>
            {pendingSetting === "auto-retry"
              ? t("Saving…", "保存中…")
              : autoRetry ? t("Enabled", "已启用") : t("Disabled", "已禁用")}
          </span>
        </label>
      </div>

      <div className="settings-group">
        <span className="settings-group-label">{t("Auto Compaction", "自动压缩")}</span>
        <p className="settings-group-desc">
          {t("Automatically compact context when approaching the limit.", "接近上下文上限时自动压缩。")}
        </p>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={autoCompaction}
            disabled={!session || pendingSetting !== null}
            onChange={(event) => handleAutoCompaction(event.target.checked)}
          />
          <span>
            {pendingSetting === "auto-compaction"
              ? t("Saving…", "保存中…")
              : autoCompaction ? t("Enabled", "已启用") : t("Disabled", "已禁用")}
          </span>
        </label>
      </div>

      <div className="settings-group">
        <span className="settings-group-label">{t("Manual Compaction", "手动压缩")}</span>
        <p className="settings-group-desc">
          {t("Summarize older messages now to free context for the current session.", "立即总结较早消息，为当前会话释放上下文。")}
        </p>
        <button className="settings-btn" type="button" disabled={manualCompactDisabled} onClick={handleManualCompact}>
          {compacting ? t("Compacting…", "压缩中…") : t("Compact now", "立即压缩")}
        </button>
      </div>
    </div>
  );
}
