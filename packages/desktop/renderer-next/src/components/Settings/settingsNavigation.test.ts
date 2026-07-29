import { describe, expect, it } from "vitest";
import { filterSettingsNavigation, getSettingsNavigation } from "./settingsNavigation";

describe("settings navigation search", () => {
  it("matches localized labels and bilingual keywords", () => {
    const english = getSettingsNavigation("en");
    const chinese = getSettingsNavigation("zh-CN");

    expect(filterSettingsNavigation(english, "theme", "en").map((item) => item.route)).toEqual(["appearance"]);
    expect(filterSettingsNavigation(chinese, "主题", "zh-CN").map((item) => item.route)).toEqual(["appearance"]);
    expect(filterSettingsNavigation(english, "text size", "en").map((item) => item.route)).toEqual(["appearance"]);
    expect(filterSettingsNavigation(chinese, "文字大小", "zh-CN").map((item) => item.route)).toEqual(["appearance"]);
    expect(filterSettingsNavigation(chinese, "手动压缩", "zh-CN").map((item) => item.route)).toEqual(["agent-general"]);
    expect(filterSettingsNavigation(chinese, "记忆", "zh-CN").map((item) => item.route)).toEqual(["memory"]);
    expect(filterSettingsNavigation(chinese, "恢复默认", "zh-CN").map((item) => item.route)).toEqual([
      "appearance",
      "shortcuts",
    ]);
    expect(filterSettingsNavigation(chinese, "theme", "zh-CN").map((item) => item.route)).toEqual(["appearance"]);
    expect(filterSettingsNavigation(english, "model backup", "en").map((item) => item.route)).toEqual(["models-providers"]);
    expect(filterSettingsNavigation(chinese, "API", "zh-CN").map((item) => item.route)).toEqual([
      "custom-providers",
      "account",
    ]);
    expect(filterSettingsNavigation(chinese, "SSH 远程", "zh-CN").map((item) => item.route)).toEqual(["connections"]);
  });

  it("returns all pages for a blank query", () => {
    const items = getSettingsNavigation("zh-CN");
    expect(filterSettingsNavigation(items, "  ", "zh-CN")).toHaveLength(items.length);
    expect(items.some((item) => item.route === "resources" && item.label === "资源")).toBe(true);
    expect(items.some((item) => item.route === "memory" && item.label === "记忆")).toBe(true);
  });
});
