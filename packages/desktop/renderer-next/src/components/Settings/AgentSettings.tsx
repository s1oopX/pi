import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import * as api from "../../ipc/api";
import type { QueueMode, ThinkingLevel } from "../../ipc/types";
import { useStore, type PermissionMode } from "../../store";
import { PERMISSION_MODE_OPTIONS } from "../PermissionSelector/permissionModes";
import { showToast } from "../Toast";
import { hasPermissionModeExtension } from "./settingsLogic";
import { SettingsSectionIcon } from "./SettingsSectionIcon";

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
  const [permissionExtensionStatus, setPermissionExtensionStatus] = useState<
    "unknown" | "available" | "missing"
  >("unknown");
  const [poolSettings, setPoolSettings] = useState<api.TaskPoolSettings | null>(null);
  const [poolSettingsSaving, setPoolSettingsSaving] = useState(false);
  const refreshTasks = useStore((state) => state.refreshTasks);
  const [leftovers, setLeftovers] = useState<api.WorktreeLeftover[]>([]);
  const [armedLeftover, setArmedLeftover] = useState<string | null>(null);
  const [deletingLeftover, setDeletingLeftover] = useState<string | null>(null);
  const thinkingLevel = (session?.thinkingLevel ?? "medium") as ThinkingLevel;
  // Match SettingsManager defaults: queue modes are one-at-a-time unless configured.
  const steeringMode = (session?.steeringMode ?? "one-at-a-time") as QueueMode;
  const followUpMode = (session?.followUpMode ?? "one-at-a-time") as QueueMode;
  const autoCompaction = session?.autoCompactionEnabled ?? true;
  const autoRetry = session?.autoRetryEnabled ?? true;
  const sessionReady = session !== null;
  const sessionControlsDisabled = !sessionReady || pendingSetting !== null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const resources = await api.getResources();
        if (cancelled) return;
        setPermissionExtensionStatus(
          hasPermissionModeExtension(resources) ? "available" : "missing",
        );
      } catch {
        if (!cancelled) setPermissionExtensionStatus("unknown");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  useEffect(() => {
    let cancelled = false;
    void api.getTaskSettings().then((settings) => {
      if (!cancelled && settings) setPoolSettings(settings);
    }).catch(() => {});
    void api.listWorktreeLeftovers().then((entries) => {
      if (!cancelled) setLeftovers(entries);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDeleteLeftover(path: string) {
    if (armedLeftover !== path) {
      setArmedLeftover(path);
      return;
    }
    setArmedLeftover(null);
    setDeletingLeftover(path);
    try {
      await api.deleteWorktreeLeftover(path);
      setLeftovers(await api.listWorktreeLeftovers());
      showToast(t("Worktree deleted", "工作树已删除"), "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("Could not delete the worktree: {message}", "删除工作树失败：{message}", { message }), "error");
    } finally {
      setDeletingLeftover(null);
    }
  }

  async function handlePoolSettings(update: Partial<api.TaskPoolSettings>) {
    setPoolSettingsSaving(true);
    try {
      const applied = await api.configureTasks(update);
      setPoolSettings(applied);
      // The sidebar's full-pool state follows the live cap.
      await refreshTasks();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("Failed: {message}", "失败：{message}", { message }), "error");
    } finally {
      setPoolSettingsSaving(false);
    }
  }

  async function handleThinking(level: ThinkingLevel) {
    if (!sessionReady) return;
    try {
      await api.setThinkingLevel(level);
      useStore.getState().refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("Failed: {message}", "失败：{message}", { message }), "error");
    }
  }

  async function handleSteeringMode(mode: QueueMode) {
    if (!sessionReady) return;
    try {
      await api.setSteeringMode(mode);
      useStore.getState().refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("Failed: {message}", "失败：{message}", { message }), "error");
    }
  }

  async function handleFollowUpMode(mode: QueueMode) {
    if (!sessionReady) return;
    try {
      await api.setFollowUpMode(mode);
      useStore.getState().refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(t("Failed: {message}", "失败：{message}", { message }), "error");
    }
  }

  async function handleAutoCompaction(enabled: boolean) {
    if (!sessionReady) return;
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
    if (!sessionReady) return;
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
      <h3 className="settings-section-title">
        <SettingsSectionIcon route="agent-general" />
        {t("Agent Settings", "智能体设置")}
      </h3>
      {!sessionReady && (
        <p className="settings-section-desc" role="status">
          {t(
            "The current session is not ready. Session-specific settings cannot be changed yet.",
            "当前会话未就绪，暂时无法修改会话级设置。",
          )}
        </p>
      )}

      <div className="settings-group">
        <span className="settings-group-label">{t("Tool Permissions", "工具权限")}</span>
        <p className="settings-group-desc">
          {t("Choose when the agent asks before running commands or changing files.", "选择智能体在运行命令或更改文件前何时询问。")}
        </p>
        {permissionExtensionStatus === "missing" && (
          <p className="settings-group-desc" role="status">
            {t(
              "The tool-approval extension is not loaded. Changing this setting will not enforce tool permissions until it is available.",
              "未加载 tool-approval 扩展。在可用前，更改此设置不会真正约束工具权限。",
            )}
          </p>
        )}
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
                disabled={sessionControlsDisabled}
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
        <select className="form-select" value={steeringMode} disabled={sessionControlsDisabled} onChange={(event) => handleSteeringMode(event.target.value as QueueMode)}>
          {QUEUE_MODES.map((mode) => <option key={mode} value={mode}>{queueModeLabel(mode)}</option>)}
        </select>
      </div>

      <div className="settings-group">
        <span className="settings-group-label">{t("Follow-up Mode", "跟进消息模式")}</span>
        <p className="settings-group-desc">
          {t("How follow-up messages are dispatched after a turn completes.", "一轮完成后如何发送跟进消息。")}
        </p>
        <select className="form-select" value={followUpMode} disabled={sessionControlsDisabled} onChange={(event) => handleFollowUpMode(event.target.value as QueueMode)}>
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
            disabled={sessionControlsDisabled}
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
            disabled={sessionControlsDisabled}
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

      <div className="settings-group">
        <span className="settings-group-label">{t("Parallel Tasks", "并行任务")}</span>
        <p className="settings-group-desc">
          {t(
            "Each parallel task runs its own backend process. Idle tasks stop themselves; their sessions reopen instantly.",
            "每个并行任务运行独立的后端进程。空闲任务会自行停止，其会话可随时重新打开。",
          )}
        </p>
        <div className="settings-pool-fields">
          <label className="settings-pool-field">
            <span>{t("Task limit", "任务上限")}</span>
            <select
              className="form-select"
              value={String(poolSettings?.maxTasks ?? 3)}
              disabled={!poolSettings || poolSettingsSaving}
              onChange={(event) => void handlePoolSettings({ maxTasks: Number(event.target.value) })}
            >
              {[1, 2, 3, 4, 5].map((count) => (
                <option key={count} value={String(count)}>{count}</option>
              ))}
            </select>
          </label>
          <label className="settings-pool-field">
            <span>{t("Stop idle tasks after", "空闲多久后停止")}</span>
            <select
              className="form-select"
              value={String(poolSettings?.idleMinutes ?? 30)}
              disabled={!poolSettings || poolSettingsSaving}
              onChange={(event) => void handlePoolSettings({ idleMinutes: Number(event.target.value) })}
            >
              <option value="15">{t("15 minutes", "15 分钟")}</option>
              <option value="30">{t("30 minutes", "30 分钟")}</option>
              <option value="60">{t("1 hour", "1 小时")}</option>
              <option value="120">{t("2 hours", "2 小时")}</option>
              <option value="0">{t("Never", "从不")}</option>
            </select>
          </label>
        </div>
        {leftovers.length > 0 && (
          <div className="worktree-leftovers">
            <span className="worktree-leftovers-title">
              {t("Leftover worktrees", "遗留的工作树")}
            </span>
            <p className="settings-group-desc">
              {t(
                "Worktrees kept from stopped tasks. Deleting one discards any uncommitted changes in it; the task branch stays.",
                "已停止任务保留下来的工作树。删除会丢弃其中未提交的改动；任务分支会保留。",
              )}
            </p>
            {leftovers.map((leftover) => (
              <div className="worktree-leftover-row" key={leftover.path}>
                <span className="worktree-leftover-path" title={leftover.path}>{leftover.path}</span>
                {leftover.dirty === true && (
                  <span className="worktree-leftover-dirty">{t("has changes", "有改动")}</span>
                )}
                <button
                  className="settings-btn-sm worktree-leftover-delete"
                  type="button"
                  disabled={deletingLeftover === leftover.path}
                  onClick={() => void handleDeleteLeftover(leftover.path)}
                  onBlur={() => setArmedLeftover((current) => (current === leftover.path ? null : current))}
                >
                  {deletingLeftover === leftover.path
                    ? t("Deleting...", "正在删除...")
                    : armedLeftover === leftover.path
                      ? t("Confirm delete", "确认删除")
                      : t("Delete", "删除")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
