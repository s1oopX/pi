import type { ReactNode } from "react";
import { useI18n } from "../../i18n";
import * as api from "../../ipc/api";
import { useStore } from "../../store";
import { BrandIcon } from "../BrandIcon";
import { isSameWorkspace } from "../Sidebar/sidebarState";
import { showToast } from "../Toast";

interface LocalizedText {
  english: string;
  simplifiedChinese: string;
}

interface ActionCard {
  id: string;
  title: LocalizedText;
  description: LocalizedText;
  prompt: LocalizedText;
  icon: ReactNode;
}

const ACTION_CARDS: ActionCard[] = [
  {
    id: "explore-codebase",
    title: { english: "Explore the codebase", simplifiedChinese: "探索代码库" },
    description: {
      english: "Map structure and module relationships",
      simplifiedChinese: "梳理结构和模块关系",
    },
    prompt: {
      english: "Explore this codebase and give me an overview of its structure, main modules, and how they fit together.",
      simplifiedChinese: "请探索这个代码库，概述其结构、主要模块及它们之间的关系。",
    },
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="m20 20-3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "build-feature",
    title: { english: "Build a new feature", simplifiedChinese: "开发新功能" },
    description: {
      english: "Add functionality or extend tools",
      simplifiedChinese: "添加功能或扩展工具",
    },
    prompt: {
      english: "I want to build a new feature. Help me plan and implement it. Here is what I have in mind: ",
      simplifiedChinese: "我想开发一个新功能。请帮我规划并实现。我的想法是：",
    },
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "review-changes",
    title: { english: "Review changes", simplifiedChinese: "审查更改" },
    description: {
      english: "Get feedback and improvements",
      simplifiedChinese: "获取反馈和修改建议",
    },
    prompt: {
      english: "Review the recent changes in this repository and suggest improvements.",
      simplifiedChinese: "请审查这个仓库中的近期更改，并提出改进建议。",
    },
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "fix-problem",
    title: { english: "Fix a problem", simplifiedChinese: "修复问题" },
    description: {
      english: "Diagnose errors or unexpected behavior",
      simplifiedChinese: "诊断错误或异常行为",
    },
    prompt: {
      english: "I'm hitting a problem. Help me diagnose and fix it. Here are the details: ",
      simplifiedChinese: "我遇到了一个问题。请帮我诊断并修复。具体情况是：",
    },
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M12 9v4M12 17h.01" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export function EmptyState() {
  const { t } = useI18n();
  const models = useStore((s) => s.models);
  const openSettings = useStore((s) => s.openSettings);
  const setComposerDraft = useStore((s) => s.setComposerDraft);
  const workspaceCwd = useStore((s) => s.workspaceCwd);
  const taskCwd = useStore((s) => s.taskCwd);
  const isTaskContext = Boolean(taskCwd && isSameWorkspace(workspaceCwd, taskCwd));
  const workspaceName = isTaskContext
    ? t("Tasks", "任务")
    : workspaceCwd.split(/[\\/]/).filter(Boolean).pop();
  const backendStatus = useStore((s) => s.backendStatus);

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
    return (
      <div className="empty-state" role="status">
        <div className="empty-state-icon empty-state-brand" aria-hidden="true">
          <BrandIcon className="empty-state-brand-icon" />
        </div>
        <h2 className="empty-state-title">
          {isStarting ? t("Preparing workspace...", "正在准备工作区……") : t("Agent offline", "智能体已离线")}
        </h2>
        <p className="empty-state-subtitle">
          {isStarting
            ? t("Preparing {workspace}.", "正在准备 {workspace}。", {
                workspace: workspaceName ?? t("the current workspace", "当前工作区"),
              })
            : backendStatus.error ?? t(
                "The backend is unavailable. Your draft will be preserved.",
                "后端当前不可用。你的草稿会保留。",
              )}
        </p>
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
          <svg viewBox="0 0 24 24" width="40" height="40">
            <rect x="3" y="4" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 21h8M12 18v3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
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
      <h2 className="empty-state-title">{t("What should we work on?", "我们要做什么？")}</h2>
      <p className="empty-state-subtitle">
        {isTaskContext
          ? t("Start a task, or pick a prompt below.", "开始一个任务，或选择下方提示。")
          : workspaceName
          ? t("Start a thread in {workspace}, or pick a prompt below.", "在 {workspace} 中开始会话，或选择下方提示。", {
              workspace: workspaceName,
            })
          : t("Pick a starting point, or type a message below.", "选择一个起点，或在下方输入消息。")}
      </p>
      <div className="empty-state-cards">
        {ACTION_CARDS.map((card) => (
          <button
            key={card.id}
            className="empty-state-card"
            type="button"
            onClick={() => setComposerDraft(t(card.prompt.english, card.prompt.simplifiedChinese))}
          >
            <span className="empty-state-card-icon" aria-hidden="true">{card.icon}</span>
            <span className="empty-state-card-title">{t(card.title.english, card.title.simplifiedChinese)}</span>
            <span className="empty-state-card-desc">
              {t(card.description.english, card.description.simplifiedChinese)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
