import type { ResolvedLanguage } from "../../i18n";
import { translateText } from "../../i18n";
import type { SettingsRoute } from "../../store";

export type ConcreteSettingsRoute = Exclude<SettingsRoute, null>;

interface LocalizedText {
  en: string;
  zhCN: string;
}

interface SettingsNavigationDefinition {
  route: ConcreteSettingsRoute;
  label: LocalizedText;
  keywords: LocalizedText;
}

export interface SettingsNavigationItem {
  route: ConcreteSettingsRoute;
  label: string;
  searchText: string;
}

const SETTINGS_NAVIGATION: SettingsNavigationDefinition[] = [
  {
    route: "models-providers",
    label: { en: "Models & Providers", zhCN: "模型与提供商" },
    keywords: { en: "model provider active import export backup", zhCN: "模型 提供商 切换 导入 导出 备份" },
  },
  {
    route: "custom-providers",
    label: { en: "Custom Providers", zhCN: "自定义提供商" },
    keywords: { en: "endpoint base url compatible model api", zhCN: "接口 地址 兼容 模型 API" },
  },
  {
    route: "account",
    label: { en: "Account", zhCN: "账户" },
    keywords: { en: "api key authentication credential", zhCN: "密钥 认证 凭据" },
  },
  {
    route: "agent-general",
    label: { en: "Agent", zhCN: "智能体" },
    keywords: {
      en: "permission thinking steering follow-up retry compaction manual compact auto context compact now",
      zhCN: "权限 思考 引导 跟进 重试 压缩 手动压缩 自动压缩 上下文 立即压缩",
    },
  },
  {
    route: "appearance",
    label: { en: "Appearance", zhCN: "外观" },
    keywords: {
      en: "theme language font scale text size density interface spacing restore defaults",
      zhCN: "主题 语言 字体 缩放 文字大小 密度 界面密度 间距 恢复 默认 恢复默认",
    },
  },
  {
    route: "shortcuts",
    label: { en: "Keyboard Shortcuts", zhCN: "键盘快捷键" },
    keywords: { en: "keys hotkey command reset restore defaults", zhCN: "按键 热键 命令 重置 恢复 默认 恢复默认" },
  },
  {
    route: "resources",
    label: { en: "Resources", zhCN: "资源" },
    keywords: { en: "extension skill prompt diagnostic error refresh reload loading", zhCN: "扩展 技能 提示词 诊断 错误 刷新 重新加载 加载" },
  },
  {
    route: "about",
    label: { en: "About", zhCN: "关于" },
    keywords: { en: "version backend diagnostics update workspace", zhCN: "版本 后端 诊断 更新 工作区" },
  },
];

export function getSettingsNavigation(language: ResolvedLanguage): SettingsNavigationItem[] {
  return SETTINGS_NAVIGATION.map((item) => {
    const label = translateText(language, item.label.en, item.label.zhCN);
    return {
      route: item.route,
      label,
      searchText: [item.label.en, item.label.zhCN, item.keywords.en, item.keywords.zhCN].join(" "),
    };
  });
}

export function filterSettingsNavigation(
  items: readonly SettingsNavigationItem[],
  query: string,
  language: ResolvedLanguage,
): SettingsNavigationItem[] {
  const normalizedTerms = query.trim().toLocaleLowerCase(language).split(/\s+/).filter(Boolean);
  if (normalizedTerms.length === 0) return [...items];
  return items.filter((item) => {
    const searchText = item.searchText.toLocaleLowerCase(language);
    return normalizedTerms.every((term) => searchText.includes(term));
  });
}
