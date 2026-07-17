/** Path action helpers for process rows (copy / reveal). */

export function pathActionCopyLabel(language: "en" | "zh-CN" = "en"): string {
  return language === "zh-CN" ? "复制路径" : "Copy path";
}

export function pathActionRevealLabel(language: "en" | "zh-CN" = "en"): string {
  return language === "zh-CN" ? "在资源管理器中显示" : "Reveal in Explorer";
}

export function pathCopiedToast(language: "en" | "zh-CN" = "en"): string {
  return language === "zh-CN" ? "路径已复制" : "Path copied";
}

export function pathRevealFailedToast(language: "en" | "zh-CN" = "en"): string {
  return language === "zh-CN" ? "无法打开路径" : "Could not open path";
}
