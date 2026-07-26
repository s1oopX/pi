import { t } from "../../i18n";
import * as api from "../../ipc/api";
import { useStore } from "../../store";
import { showToast } from "../Toast";
import type { PaletteCommandId } from "./commandPaletteState";
import { findLastReplyCopyText } from "./copyLastReply";

let newThreadPending = false;

function afterSettingsClose(action: () => void): void {
  useStore.getState().closeSettings();
  requestAnimationFrame(() => requestAnimationFrame(action));
}

function focusElement(selector: string, unavailableMessage: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    showToast(unavailableMessage, "error");
    return;
  }
  element.focus();
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) element.select();
}

async function createNewThread(): Promise<void> {
  if (newThreadPending) return;
  const state = useStore.getState();
  if (!state.backendStatus.ready) {
    showToast(t("The agent backend is not ready", "智能体后端尚未就绪"), "error");
    return;
  }
  if (state.isStreaming) {
    showToast(t("Finish or stop the current run before creating a new thread.", "请先完成或停止当前运行，再新建会话。"), "warning");
    return;
  }

  newThreadPending = true;
  state.closeSettings();
  try {
    const result = await api.newSession();
    if (result.cancelled) return;
    await useStore.getState().resetForWorkspace(result.cwd);
    focusElement(".composer-input", t("Message input is not available", "消息输入框不可用"));
  } catch (error) {
    showToast(t("Failed to create thread: {error}", "创建会话失败：{error}", {
      error: error instanceof Error ? error.message : String(error),
    }), "error");
  } finally {
    newThreadPending = false;
  }
}

function focusThreadSearch(): void {
  afterSettingsClose(() => {
    const searchInput = document.querySelector<HTMLInputElement>(".thread-search-input");
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
      return;
    }

    const expandButton = document.querySelector<HTMLButtonElement>(".sidebar.collapsed .sidebar-toggle");
    if (!expandButton) {
      showToast(t("Thread search is not available", "会话搜索不可用"), "error");
      return;
    }
    expandButton.click();
    requestAnimationFrame(() => focusElement(
      ".thread-search-input",
      t("Thread search is not available", "会话搜索不可用"),
    ));
  });
}

function openWorkspaceSwitcher(): void {
  afterSettingsClose(() => {
    const trigger = document.querySelector<HTMLButtonElement>(".sidebar-rail-workspace:not(:disabled)");
    if (trigger) {
      trigger.click();
      return;
    }
    const visibleWorkspaceTarget = document.querySelector<HTMLButtonElement>(
      ".project-tree-main:not(:disabled), .workspace-navigation-empty:not(:disabled), .workspace-navigation-add:not(:disabled)",
    );
    if (visibleWorkspaceTarget) {
      visibleWorkspaceTarget.focus();
      return;
    }
    showToast(t("Workspace switching is not available", "工作区切换不可用"), "error");
  });
}

function copyLastReply(): void {
  const text = findLastReplyCopyText(useStore.getState().messages);
  if (!text) {
    showToast(t("No assistant reply to copy yet", "还没有可复制的回复"), "info");
    return;
  }
  navigator.clipboard
    ?.writeText(text)
    .then(() => showToast(t("Last reply copied", "已复制最后回复"), "success"))
    .catch(() => showToast(t("Could not copy the reply", "复制回复失败"), "error"));
}

export function runAppCommand(commandId: PaletteCommandId): void {
  switch (commandId) {
    case "open-settings":
      useStore.getState().openSettings("models-providers");
      return;
    case "new-thread":
      void createNewThread();
      return;
    case "focus-thread-search":
      focusThreadSearch();
      return;
    case "focus-composer":
      afterSettingsClose(() => focusElement(
        ".composer-input",
        t("Message input is not available", "消息输入框不可用"),
      ));
      return;
    case "switch-workspace":
      openWorkspaceSwitcher();
      return;
    case "copy-last-reply":
      copyLastReply();
      return;
  }
}
