import { translateText, type ResolvedLanguage } from "../../i18n";

const RESOURCE_SOURCE_LABELS: Readonly<Record<string, { en: string; zhCN: string }>> = {
  auto: { en: "auto-discovered", zhCN: "自动发现" },
  cli: { en: "command line", zhCN: "命令行" },
  inline: { en: "inline", zhCN: "内联" },
  local: { en: "local", zhCN: "本地" },
  temporary: { en: "temporary", zhCN: "临时" },
};

export function getResourceSourceLabel(source: string, language: ResolvedLanguage): string {
  const label = RESOURCE_SOURCE_LABELS[source.toLocaleLowerCase("en")];
  return label ? translateText(language, label.en, label.zhCN) : source;
}
