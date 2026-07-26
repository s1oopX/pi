import { translateText, type ResolvedLanguage } from "../../i18n";
import type { AppCommandId } from "../../keybindings/appKeybindings";

export type PaletteCommandId = Exclude<AppCommandId, "open-command-palette">;

export interface CommandPaletteEntry {
  id: PaletteCommandId;
  label: string;
  description: string;
  keywords: readonly string[];
  disabled?: boolean;
  disabledReason?: string;
}

interface CommandPaletteTranslation {
  label: string;
  description: string;
  keywords: readonly string[];
}

const SIMPLIFIED_CHINESE_COMMANDS: Record<PaletteCommandId, CommandPaletteTranslation> = {
  "open-settings": {
    label: "打开设置",
    description: "配置模型、提供商、智能体行为和外观",
    keywords: ["偏好", "配置", "模型", "提供商"],
  },
  "new-thread": {
    label: "新建会话",
    description: "在当前工作区中开始新的智能体会话",
    keywords: ["对话", "聊天", "智能体"],
  },
  "focus-thread-search": {
    label: "搜索会话",
    description: "聚焦当前工作区的会话搜索框",
    keywords: ["查找", "历史", "侧边栏"],
  },
  "focus-composer": {
    label: "聚焦消息输入框",
    description: "将焦点移至提示词输入区",
    keywords: ["提示词", "输入", "聊天", "消息"],
  },
  "switch-workspace": {
    label: "切换工作区",
    description: "打开工作区切换器",
    keywords: ["文件夹", "项目", "仓库", "最近"],
  },
  "toggle-workbench": {
    label: "切换工作台",
    description: "打开或关闭右侧工作台",
    keywords: ["分屏", "右侧", "工具"],
  },
  "open-workbench-review": {
    label: "打开审阅",
    description: "在工作台中打开分支和审阅工具",
    keywords: ["分支", "审核", "变更"],
  },
  "open-workbench-terminal": {
    label: "打开终端",
    description: "在工作台中打开终端",
    keywords: ["命令", "shell", "bash"],
  },
  "open-workbench-browser": {
    label: "打开浏览器",
    description: "在工作台中打开浏览器操作",
    keywords: ["网页", "链接", "url"],
  },
  "open-workbench-files": {
    label: "打开文件",
    description: "在工作台中搜索工作区文件",
    keywords: ["搜索", "路径", "引用"],
  },
  "open-workbench-side-task": {
    label: "打开侧边任务",
    description: "从工作台创建任务",
    keywords: ["任务", "后台", "新建"],
  },
  "copy-last-reply": {
    label: "复制最后回复",
    description: "将智能体最近一次回复复制为纯文本",
    keywords: ["剪贴板", "复制", "回复", "回答"],
  },
};

export const COMMAND_PALETTE_ENTRIES: readonly CommandPaletteEntry[] = [
  {
    id: "open-settings",
    label: "Open Settings",
    description: "Configure models, providers, agent behavior, and appearance",
    keywords: ["preferences", "configuration", "models", "providers"],
  },
  {
    id: "new-thread",
    label: "New Thread",
    description: "Start a fresh agent session in the current workspace",
    keywords: ["session", "conversation", "chat", "agent"],
  },
  {
    id: "focus-thread-search",
    label: "Search Threads",
    description: "Focus the thread search for this workspace",
    keywords: ["find", "history", "sessions", "sidebar"],
  },
  {
    id: "focus-composer",
    label: "Focus Message Input",
    description: "Move focus to the prompt composer",
    keywords: ["prompt", "composer", "chat", "message"],
  },
  {
    id: "switch-workspace",
    label: "Switch Workspace",
    description: "Open the workspace switcher",
    keywords: ["folder", "project", "repository", "recent"],
  },
  {
    id: "toggle-workbench",
    label: "Toggle Workbench",
    description: "Open or close the right workbench",
    keywords: ["split", "right", "tools", "panel"],
  },
  {
    id: "open-workbench-review",
    label: "Open Review",
    description: "Open branch and review tools in the workbench",
    keywords: ["branch", "changes", "review"],
  },
  {
    id: "open-workbench-terminal",
    label: "Open Terminal",
    description: "Open the terminal in the workbench",
    keywords: ["command", "shell", "bash"],
  },
  {
    id: "open-workbench-browser",
    label: "Open Browser",
    description: "Open browser actions in the workbench",
    keywords: ["web", "url", "link"],
  },
  {
    id: "open-workbench-files",
    label: "Open Files",
    description: "Search workspace files in the workbench",
    keywords: ["file", "path", "reference"],
  },
  {
    id: "open-workbench-side-task",
    label: "Open Side Task",
    description: "Create a task from the workbench",
    keywords: ["task", "background", "new"],
  },
  {
    id: "copy-last-reply",
    label: "Copy Last Reply",
    description: "Copy the assistant's latest reply as plain text",
    keywords: ["clipboard", "copy", "response", "answer"],
  },
];

export function localizeCommandPaletteEntries(
  entries: readonly CommandPaletteEntry[],
  language: ResolvedLanguage,
): CommandPaletteEntry[] {
  return entries.map((entry) => {
    const translation = SIMPLIFIED_CHINESE_COMMANDS[entry.id];
    return {
      ...entry,
      label: translateText(language, entry.label, translation.label),
      description: translateText(language, entry.description, translation.description),
      keywords: language === "zh-CN"
        ? [...entry.keywords, entry.label, entry.description, ...translation.keywords]
        : entry.keywords,
      disabledReason: entry.disabledReason === "Agent backend is not ready"
        ? translateText(language, entry.disabledReason, "智能体后端尚未就绪")
        : entry.disabledReason === "Finish or stop the current run first"
          ? translateText(language, entry.disabledReason, "请先完成或停止当前运行")
          : entry.disabledReason,
    };
  });
}

export function filterCommandPaletteEntries(
  entries: readonly CommandPaletteEntry[],
  query: string,
): CommandPaletteEntry[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...entries];

  return entries
    .map((entry, index) => {
      const label = entry.label.toLocaleLowerCase();
      const haystack = `${label} ${entry.description.toLocaleLowerCase()} ${entry.keywords.join(" ").toLocaleLowerCase()}`;
      if (!terms.every((term) => haystack.includes(term))) return null;
      const joinedQuery = terms.join(" ");
      const score = label === joinedQuery ? 0 : label.startsWith(joinedQuery) ? 1 : label.includes(joinedQuery) ? 2 : 3;
      return { entry, index, score };
    })
    .filter((candidate): candidate is { entry: CommandPaletteEntry; index: number; score: number } => candidate !== null)
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map(({ entry }) => entry);
}

export function moveCommandPaletteSelection(
  entries: readonly CommandPaletteEntry[],
  currentIndex: number,
  direction: 1 | -1,
): number {
  if (entries.length === 0 || entries.every((entry) => entry.disabled)) return -1;
  for (let offset = 1; offset <= entries.length; offset++) {
    const index = (currentIndex + direction * offset + entries.length) % entries.length;
    if (!entries[index].disabled) return index;
  }
  return -1;
}

export function findCommandPaletteEdge(
  entries: readonly CommandPaletteEntry[],
  edge: "first" | "last",
): number {
  if (edge === "first") return entries.findIndex((entry) => !entry.disabled);
  for (let index = entries.length - 1; index >= 0; index--) {
    if (!entries[index].disabled) return index;
  }
  return -1;
}
