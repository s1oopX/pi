import { useI18n } from "../../i18n";
import * as api from "../../ipc/api";
import { useStore } from "../../store";
import { BrandIcon } from "../BrandIcon";
import { Icon, type IconName } from "../Icon";
import { isSameWorkspace } from "../Sidebar/sidebarState";
import { showToast } from "../Toast";

const ACTION_CARDS: ReadonlyArray<{
  title: [string, string];
  prompt: [string, string];
  icon: IconName;
}> = [
  {
    title: ["Explore and understand the code", "探索并理解代码"],
    prompt: [
      "Explore this codebase and explain its structure, main modules, and how they fit together.",
      "请探索这个代码库，并说明它的结构、主要模块以及它们之间的关系。",
    ],
    icon: "search",
  },
  {
    title: ["Build a new feature, app, or tool", "构建新功能、应用或工具"],
    prompt: [
      "Help me build a new feature, app, or tool. Start by understanding what I need, then plan and implement it.",
      "请帮我构建一个新功能、应用或工具。先了解我的需求，再规划并实现它。",
    ],
    icon: "plus",
  },
  {
    title: ["Review code and suggest improvements", "审查代码并提出修改建议"],
    prompt: [
      "Review the relevant code and suggest concrete improvements, including any bugs or risks you find.",
      "请审查相关代码，并提出具体的修改建议，包括你发现的错误或风险。",
    ],
    icon: "check",
  },
  {
    title: ["Fix problems and failures", "修复问题和失败"],
    prompt: [
      "Help me diagnose and fix this problem. I will provide the symptoms and any relevant context.",
      "请帮我诊断并修复这个问题。我会提供现象和相关背景。",
    ],
    icon: "alert-triangle",
  },
];

export function EmptyState() {
  const { t } = useI18n();
  const models = useStore((s) => s.models);
  const openSettings = useStore((s) => s.openSettings);
  const workspaceCwd = useStore((s) => s.workspaceCwd);
  const taskCwd = useStore((s) => s.taskCwd);
  const isTaskContext = Boolean(taskCwd && isSameWorkspace(workspaceCwd, taskCwd));
  const workspaceName = isTaskContext
    ? t("Tasks", "任务")
    : workspaceCwd.split(/[\\/]/).filter(Boolean).pop();
  const backendStatus = useStore((s) => s.backendStatus);
  const setComposerDraft = useStore((s) => s.setComposerDraft);

  async function restartBackend() {
    try {
      await api.restartBackend();
    } catch (error) {
      showToast(t("Failed to restart agent: {error}", "重启智能体失败：{error}", {
        error: error instanceof Error ? error.message : String(error),
      }), "error");
    }
  }

  if (!backendStatus.ready) {
    const isStarting = backendStatus.starting || backendStatus.restarting;
    const isStopping = backendStatus.restarting && !backendStatus.starting;
    const title = isStopping
      ? t("Stopping current agent…", "正在关闭当前智能体…")
      : isStarting
        ? t("Starting agent…", "正在启动智能体…")
        : t("Agent offline", "智能体已离线");
    const subtitle = isStopping
      ? t("Closing the previous workspace agent before switching.", "切换前先关闭上一工作区的智能体。")
      : isStarting
        ? t("Starting agent in {workspace}.", "正在 {workspace} 中启动智能体。", {
            workspace: workspaceName ?? t("the current workspace", "当前工作区"),
          })
        : backendStatus.error ?? t(
            "The backend is unavailable. Your draft will be preserved.",
            "后端当前不可用。你的草稿会保留。",
          );
    return (
      <div className="empty-state" role="status">
        <div className="empty-state-icon empty-state-brand" aria-hidden="true">
          <BrandIcon className="empty-state-brand-icon" />
        </div>
        <h2 className="empty-state-title">{title}</h2>
        <p className="empty-state-subtitle">{subtitle}</p>
        {!isStarting && (
          <button className="empty-state-cta" type="button" onClick={restartBackend}>
            {t("Retry agent startup", "重新启动智能体")}
          </button>
        )}
      </div>
    );
  }

  // No models configured yet: guide the user to set one up instead of letting
  // them type a message that would fail with no model to run it.
  if (models.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon" aria-hidden="true">
          <Icon name="monitor" size={40} strokeWidth={1.4} />
        </div>
        <h2 className="empty-state-title">{t("No model configured", "尚未配置模型")}</h2>
        <p className="empty-state-subtitle">
          {t("Add a provider and pick a model to start chatting.", "添加提供商并选择模型后即可开始对话。")}
        </p>
        <button
          className="empty-state-cta"
          type="button"
          onClick={() => openSettings("custom-providers")}
        >
          {t("Open settings to configure a model", "打开设置并配置模型")}
        </button>
      </div>
    );
  }

  return (
    <div className="empty-state">
      <div className="empty-state-icon empty-state-brand" aria-hidden="true">
        <BrandIcon className="empty-state-brand-icon" />
      </div>
      <h2 className="empty-state-title">{t("What should we build?", "我们该构建什么？")}</h2>
      <div className="empty-state-cards">
        {ACTION_CARDS.map((card) => (
          <button
            key={card.title[0]}
            className="empty-state-card"
            type="button"
            onClick={() => setComposerDraft(t(card.prompt[0], card.prompt[1]))}
          >
            <span className="empty-state-card-icon" aria-hidden="true">
              <Icon name={card.icon} size={18} strokeWidth={1.6} />
            </span>
            <span className="empty-state-card-title">{t(card.title[0], card.title[1])}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
