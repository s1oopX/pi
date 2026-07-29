import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import * as api from "../../ipc/api";
import type { MemorySettings as MemorySettingsData } from "../../ipc/types";
import { useStore } from "../../store";
import { showToast } from "../Toast";
import { SettingsSectionIcon } from "./SettingsSectionIcon";

type MemoryUpdate = Partial<Pick<MemorySettingsData, "enabled" | "allowToolChats" | "useMemories" | "generateMemories">>;

export function MemorySettings() {
  const { t } = useI18n();
  const sessionId = useStore((state) => state.session?.sessionId ?? null);
  const isStreaming = useStore((state) => state.isStreaming || Boolean(state.session?.isCompacting));
  const [settings, setSettings] = useState<MemorySettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      setSettings(await api.getMemorySettings());
    } catch (error) {
      showToast(t("Could not load memory settings: {error}", "无法加载记忆设置：{error}", {
        error: error instanceof Error ? error.message : String(error),
      }), "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [sessionId]);

  async function update(update: MemoryUpdate): Promise<void> {
    setSaving(true);
    try {
      setSettings(await api.setMemorySettings(update));
    } catch (error) {
      showToast(t("Could not save memory settings: {error}", "无法保存记忆设置：{error}", {
        error: error instanceof Error ? error.message : String(error),
      }), "error");
    } finally {
      setSaving(false);
    }
  }

  async function reset(): Promise<void> {
    if (!window.confirm(t("Reset all saved memories?", "确定重置所有已保存的记忆吗？"))) return;
    setResetting(true);
    try {
      const result = await api.resetMemories();
      setSettings((current) => current ? { ...current, count: result.count } : current);
      showToast(t("Memories reset", "记忆已重置"), "success");
    } catch (error) {
      showToast(t("Could not reset memories: {error}", "无法重置记忆：{error}", {
        error: error instanceof Error ? error.message : String(error),
      }), "error");
    } finally {
      setResetting(false);
    }
  }

  const disabled = loading || saving || resetting;
  const taskDisabled = disabled || !settings?.enabled || isStreaming;
  const useDisabled = taskDisabled || Boolean(settings?.useMemoriesLocked);

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">
        <SettingsSectionIcon route="memory" />
        {t("Memory", "记忆")}
      </h3>
      <p className="settings-section-desc">
        {t(
          "Remember durable preferences between new chats. Current instructions always take priority.",
          "在新聊天之间记住持久偏好。当前指令始终优先。",
        )}
      </p>

      {!settings && loading && (
        <p className="settings-group-desc" role="status">{t("Loading…", "加载中…")}</p>
      )}

      {settings && (
        <>
          <div className="settings-group">
            <span className="settings-group-label">{t("Personalization", "个性化")}</span>
            <p className="settings-group-desc">
              {t("Enable memory use and automatic memory generation for this account.", "为此账户启用记忆使用和自动记忆生成。")}
            </p>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.enabled}
                disabled={disabled}
                onChange={(event) => void update({ enabled: event.target.checked })}
              />
              <span>{settings.enabled ? t("Enabled", "已启用") : t("Disabled", "已禁用")}</span>
            </label>
          </div>

          <div className="settings-group">
            <span className="settings-group-label">{t("Tool-assisted chats", "工具辅助聊天")}</span>
            <p className="settings-group-desc">
              {t(
                "Allow memory generation after chats that used tools. Tool output itself is never stored.",
                "允许在使用工具的聊天后生成记忆。工具输出本身不会被保存。",
              )}
            </p>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.allowToolChats}
                disabled={disabled || !settings.enabled}
                onChange={(event) => void update({ allowToolChats: event.target.checked })}
              />
              <span>{settings.allowToolChats ? t("Allowed", "允许") : t("Blocked", "阻止")}</span>
            </label>
          </div>

          <div className="settings-group">
            <span className="settings-group-label">{t("Current chat", "当前聊天")}</span>
            <p className="settings-group-desc">
              {settings.useMemoriesLocked
                ? t("Use memories is locked because this chat already has a user message.", "此聊天已有用户消息，使用记忆选项已锁定。")
                : t("Choose whether this chat reads saved memories and generates new ones when it settles.", "选择此聊天是否读取已保存记忆，并在结束时生成新记忆。")}
            </p>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.useMemories}
                disabled={useDisabled}
                onChange={(event) => void update({ useMemories: event.target.checked })}
              />
              <span>{t("Use memories", "使用记忆")}</span>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.generateMemories}
                disabled={taskDisabled}
                onChange={(event) => void update({ generateMemories: event.target.checked })}
              />
              <span>{t("Generate memories", "生成记忆")}</span>
            </label>
          </div>

          <div className="settings-group">
            <span className="settings-group-label">{t("Saved memories", "已保存记忆")}</span>
            <p className="settings-group-desc">
              {t("{count} memories are stored locally.", "本地已保存 {count} 条记忆。", { count: settings.count })}
            </p>
            <p className="settings-group-desc about-path">{settings.path}</p>
            <div className="about-actions">
              <button className="settings-btn" type="button" disabled={disabled} onClick={() => void load()}>
                {t("Refresh", "刷新")}
              </button>
              <button className="settings-btn settings-btn-danger" type="button" disabled={disabled || isStreaming} onClick={() => void reset()}>
                {resetting ? t("Resetting…", "重置中…") : t("Reset memories", "重置记忆")}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
