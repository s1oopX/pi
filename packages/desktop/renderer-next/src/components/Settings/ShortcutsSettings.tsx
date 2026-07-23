import { useMemo, useState, type KeyboardEvent } from "react";
import { useI18n } from "../../i18n";
import {
  APP_COMMAND_IDS,
  DEFAULT_APP_KEYBINDINGS,
  captureAppKeybinding,
  formatAppKeybinding,
  getAppPlatform,
  toAriaKeyshortcuts,
  type AppCommandId,
  type AppKeybindingError,
  type AppKeybindingUpdateResult,
} from "../../keybindings/appKeybindings";
import { useAppKeybindings } from "../../keybindings/useAppKeybindings";
import "./ShortcutsSettings.css";

interface ShortcutFeedback {
  commandId?: AppCommandId;
  message: string;
  tone: "error" | "status";
}

export function ShortcutsSettings() {
  const {
    keybindings,
    updateKeybinding,
    clearKeybinding,
    resetKeybinding,
    resetAllKeybindings,
  } = useAppKeybindings();
  const { t } = useI18n();
  const platform = useMemo(() => getAppPlatform(), []);
  const [recordingCommandId, setRecordingCommandId] = useState<AppCommandId | null>(null);
  const [feedback, setFeedback] = useState<ShortcutFeedback | null>(null);
  const allDefault = APP_COMMAND_IDS.every(
    (commandId) => keybindings[commandId] === DEFAULT_APP_KEYBINDINGS[commandId],
  );

  function commandLabel(commandId: AppCommandId): string {
    if (commandId === "open-command-palette") return t("Command Palette", "命令面板");
    if (commandId === "open-settings") return t("Open Settings", "打开设置");
    if (commandId === "new-thread") return t("New Thread", "新建会话");
    if (commandId === "focus-thread-search") return t("Search Threads", "搜索会话");
    if (commandId === "focus-composer") return t("Focus Message Input", "聚焦消息输入框");
    if (commandId === "switch-workspace") return t("Switch Workspace", "切换工作区");
    if (commandId === "toggle-workbench") return t("Toggle Workbench", "切换工作台");
    if (commandId === "open-workbench-review") return t("Open Review", "打开审阅");
    if (commandId === "open-workbench-terminal") return t("Open Terminal", "打开终端");
    if (commandId === "open-workbench-browser") return t("Open Browser", "打开浏览器");
    if (commandId === "open-workbench-files") return t("Open Files", "打开文件");
    return t("Open Side Task", "打开侧边任务");
  }

  function commandDescription(commandId: AppCommandId): string {
    if (commandId === "open-command-palette") return t("Find and run an application command.", "查找并运行应用命令。");
    if (commandId === "open-settings") return t("Open application settings.", "打开应用设置。");
    if (commandId === "new-thread") return t("Start a new agent session in the current workspace.", "在当前工作区中启动新的智能体会话。");
    if (commandId === "focus-thread-search") return t("Move focus to the thread search field.", "将焦点移到会话搜索框。");
    if (commandId === "focus-composer") return t("Move focus to the prompt composer.", "将焦点移到提示词编辑器。");
    if (commandId === "switch-workspace") return t("Open the workspace switcher.", "打开工作区切换器。");
    if (commandId === "toggle-workbench") return t("Open or close the right workbench.", "打开或关闭右侧工作台。");
    if (commandId === "open-workbench-review") {
      return t("Open branch and review tools in the workbench.", "在工作台中打开分支和审阅工具。");
    }
    if (commandId === "open-workbench-terminal") return t("Open the terminal in the workbench.", "在工作台中打开终端。");
    if (commandId === "open-workbench-browser") return t("Open browser actions in the workbench.", "在工作台中打开浏览器操作。");
    if (commandId === "open-workbench-files") {
      return t("Open workspace file search in the workbench.", "在工作台中搜索工作区文件。");
    }
    return t("Create a task from the workbench.", "从工作台创建任务。");
  }

  function keybindingErrorMessage(error: AppKeybindingError): string {
    if (error.code === "conflict" && error.conflictingCommandId) {
      const platformName = error.platform === "mac" ? "macOS" : t("Windows and Linux", "Windows 和 Linux");
      return t(
        "This shortcut conflicts with {command} on {platform}.",
        "此快捷键在 {platform} 上与“{command}”冲突。",
        { command: commandLabel(error.conflictingCommandId), platform: platformName },
      );
    }
    if (error.code === "storage") return t("The shortcut could not be saved to local storage.", "无法将快捷键保存到本地存储。");
    return t("Use a modifier with a key, or choose a function key from F1 through F24.", "请使用修饰键加普通按键，或选择 F1 到 F24 功能键。");
  }

  function beginRecording(commandId: AppCommandId): void {
    const label = commandLabel(commandId);
    setRecordingCommandId(commandId);
    setFeedback({
      commandId,
      message: t(
        "Recording {label}. Press a shortcut, Backspace to clear, or Escape to cancel.",
        "正在录制“{label}”。按下快捷键，按 Backspace 清除，或按 Escape 取消。",
        { label },
      ),
      tone: "status",
    });
  }

  function finishMutation(
    commandId: AppCommandId,
    result: AppKeybindingUpdateResult,
    successMessage: string,
    keepRecordingOnError: boolean,
  ): void {
    if (!result.ok) {
      if (!keepRecordingOnError) setRecordingCommandId(null);
      setFeedback({ commandId, message: keybindingErrorMessage(result.error), tone: "error" });
      return;
    }
    setRecordingCommandId(null);
    setFeedback({ commandId, message: successMessage, tone: "status" });
  }

  function handleRecordingKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    commandId: AppCommandId,
  ): void {
    if (recordingCommandId !== commandId) return;
    const capture = captureAppKeybinding(event.nativeEvent, platform);
    event.preventDefault();
    event.stopPropagation();

    const label = commandLabel(commandId);
    if (capture.type === "ignored") return;
    if (capture.type === "pending") {
      setFeedback({
        commandId,
        message: t(
          "Recording {label}. Keep the modifier held and press another key.",
          "正在录制“{label}”。请按住修饰键并按下另一个按键。",
          { label },
        ),
        tone: "status",
      });
      return;
    }
    if (capture.type === "cancel") {
      setRecordingCommandId(null);
      setFeedback({
        commandId,
        message: t("Shortcut recording canceled for {label}.", "已取消录制“{label}”的快捷键。", { label }),
        tone: "status",
      });
      return;
    }
    if (capture.type === "error") {
      setFeedback({ commandId, message: t(capture.message, "此按键组合不能用作应用快捷键。"), tone: "error" });
      return;
    }
    if (capture.type === "clear") {
      finishMutation(
        commandId,
        clearKeybinding(commandId),
        t("Shortcut cleared for {label}.", "已清除“{label}”的快捷键。", { label }),
        true,
      );
      return;
    }

    const displayBinding = formatAppKeybinding(capture.binding, platform);
    finishMutation(
      commandId,
      updateKeybinding(commandId, capture.binding),
      t("{label} changed to {binding}.", "“{label}”已更改为 {binding}。", { label, binding: displayBinding }),
      true,
    );
  }

  function handleClear(commandId: AppCommandId): void {
    const label = commandLabel(commandId);
    finishMutation(
      commandId,
      clearKeybinding(commandId),
      t("Shortcut cleared for {label}.", "已清除“{label}”的快捷键。", { label }),
      false,
    );
  }

  function handleReset(commandId: AppCommandId): void {
    const label = commandLabel(commandId);
    const defaultBinding = formatAppKeybinding(DEFAULT_APP_KEYBINDINGS[commandId], platform);
    finishMutation(
      commandId,
      resetKeybinding(commandId),
      t("{label} restored to {binding}.", "“{label}”已恢复为 {binding}。", { label, binding: defaultBinding }),
      false,
    );
  }

  function handleResetAll(): void {
    setRecordingCommandId(null);
    const result = resetAllKeybindings();
    setFeedback(result.ok
      ? { message: t("All keyboard shortcuts were restored to their defaults.", "所有键盘快捷键均已恢复为默认值。"), tone: "status" }
      : { message: keybindingErrorMessage(result.error), tone: "error" });
  }

  return (
    <div className="settings-section shortcuts-settings">
      <div className="shortcuts-heading">
        <div>
          <h3 className="settings-section-title">
            <SettingsSectionIcon route="shortcuts" />
            {t("Keyboard Shortcuts", "键盘快捷键")}
          </h3>
          <p className="settings-section-desc">
            {t("Change application commands without changing editor keybindings.", "更改应用命令快捷键，不影响编辑器按键绑定。")}
          </p>
        </div>
        <button
          className="settings-btn-sm shortcuts-reset-all"
          type="button"
          disabled={allDefault}
          onClick={handleResetAll}
        >
          {t("Restore all defaults", "全部恢复默认")}
        </button>
      </div>

      <p className="shortcuts-instructions">
        {t(
          "Select a shortcut and press the new key combination. Plain letter keys require Ctrl, Alt, or Command.",
          "选择一个快捷键并按下新的组合键。普通字母键必须搭配 Ctrl、Alt 或 Command。",
        )}
      </p>
      <div
        id="shortcuts-feedback"
        className={`shortcuts-feedback ${feedback?.tone === "error" ? "error" : ""}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {feedback?.message ?? <span aria-hidden="true">&nbsp;</span>}
      </div>

      <ul className="shortcuts-list" aria-label={t("Application shortcuts", "应用快捷键")}>
        {APP_COMMAND_IDS.map((commandId) => {
          const binding = keybindings[commandId];
          const displayBinding = binding === "" ? t("Unassigned", "未分配") : formatAppKeybinding(binding, platform);
          const recording = recordingCommandId === commandId;
          const isDefault = binding === DEFAULT_APP_KEYBINDINGS[commandId];
          const labelId = `shortcut-label-${commandId}`;
          const descriptionId = `shortcut-description-${commandId}`;
          const describedBy = feedback?.commandId === commandId
            ? `${descriptionId} shortcuts-feedback`
            : descriptionId;

          return (
            <li
              className={`shortcuts-row ${recording ? "recording" : ""}`}
              key={commandId}
              aria-labelledby={labelId}
            >
              <div className="shortcuts-copy">
                <span id={labelId} className="shortcuts-command-label">{commandLabel(commandId)}</span>
                <span id={descriptionId} className="shortcuts-command-description">{commandDescription(commandId)}</span>
              </div>
              <div className="shortcuts-actions">
                <button
                  className="shortcut-recorder"
                  type="button"
                  aria-label={recording
                    ? t("Recording shortcut for {label}", "正在录制“{label}”的快捷键", { label: commandLabel(commandId) })
                    : t(
                        "Change shortcut for {label}. Current shortcut: {binding}",
                        "更改“{label}”的快捷键。当前快捷键：{binding}",
                        { label: commandLabel(commandId), binding: displayBinding },
                      )}
                  aria-describedby={describedBy}
                  aria-keyshortcuts={toAriaKeyshortcuts(binding, platform)}
                  aria-pressed={recording}
                  data-app-shortcut-capture={recording ? "" : undefined}
                  onClick={() => beginRecording(commandId)}
                  onKeyDown={(event) => handleRecordingKeyDown(event, commandId)}
                >
                  <kbd>{recording ? t("Press keys…", "请按键…") : displayBinding}</kbd>
                </button>
                <button
                  className="shortcut-action"
                  type="button"
                  disabled={binding === ""}
                  aria-label={t("Clear shortcut for {label}", "清除“{label}”的快捷键", { label: commandLabel(commandId) })}
                  onClick={() => handleClear(commandId)}
                >
                  {t("Clear", "清除")}
                </button>
                <button
                  className="shortcut-action"
                  type="button"
                  disabled={isDefault}
                  aria-label={t("Restore default shortcut for {label}", "恢复“{label}”的默认快捷键", { label: commandLabel(commandId) })}
                  onClick={() => handleReset(commandId)}
                >
                  {t("Reset", "重置")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
