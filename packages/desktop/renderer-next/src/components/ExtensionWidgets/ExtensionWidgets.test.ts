import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { setLanguagePreference } from "../../i18n";
import {
  ExtensionWidgets,
  getRenderableExtensionWidgets,
  stripAnsiControlSequences,
  type ExtensionWidgetRecord,
} from "./ExtensionWidgets";

function widget(
  key: string,
  lines: readonly string[],
  placement: ExtensionWidgetRecord["placement"] = "aboveEditor",
  order = 0,
): ExtensionWidgetRecord {
  return { key, lines, placement, order };
}

beforeEach(() => setLanguagePreference("en", null));

describe("extension widget presentation", () => {
  it("removes terminal control sequences without changing ordinary Unicode", () => {
    expect(stripAnsiControlSequences("\u001b[31m错误\u001b[0m: café，任务完成")).toBe("错误: café，任务完成");
    expect(stripAnsiControlSequences(
      "\u001b]8;;https://example.test\u0007文档\u001b]8;;\u0007",
    )).toBe("文档");
    expect(stripAnsiControlSequences("before\u009b2Kafter")).toBe("beforeafter");
  });

  it("filters by placement, omits empty content, and preserves stable order ties", () => {
    const source = [
      widget("second", ["\u001b[33mSecond\u001b[0m"], "aboveEditor", 20),
      widget("tie-a", ["Tie A"], "aboveEditor", 10),
      widget("below", ["Below"], "belowEditor", 0),
      widget("empty", [" ", "\u001b[31m\u001b[0m"], "aboveEditor", 1),
      widget("tie-b", ["Tie B"], "aboveEditor", 10),
    ];

    expect(getRenderableExtensionWidgets(source, "aboveEditor")).toEqual([
      widget("tie-a", ["Tie A"], "aboveEditor", 10),
      widget("tie-b", ["Tie B"], "aboveEditor", 10),
      widget("second", ["Second"], "aboveEditor", 20),
    ]);
    expect(source[0].lines).toEqual(["\u001b[33mSecond\u001b[0m"]);
    expect(getRenderableExtensionWidgets(source, "belowEditor")).toEqual([
      widget("below", ["Below"], "belowEditor", 0),
    ]);
  });

  it("renders accessible plain text while preserving line breaks", () => {
    const markup = renderToStaticMarkup(createElement(ExtensionWidgets, {
      widgets: [widget("unsafe", ["<img src=x onerror=alert(1)>", "next line"])],
      placement: "aboveEditor",
    }));

    expect(markup).toContain('aria-label="Extension widgets above the message editor"');
    expect(markup).toContain('aria-label="Extension widget unsafe"');
    expect(markup).toContain("&lt;img src=x onerror=alert(1)&gt;\nnext line");
    expect(markup).not.toContain("<img");
  });

  it("renders nothing when the placement has no visible content", () => {
    expect(renderToStaticMarkup(createElement(ExtensionWidgets, {
      widgets: [widget("empty", [], "aboveEditor")],
      placement: "aboveEditor",
    }))).toBe("");
  });

  it("localizes accessible labels without changing extension content", () => {
    setLanguagePreference("zh-CN", null);
    const markup = renderToStaticMarkup(createElement(ExtensionWidgets, {
      widgets: [widget("build", ["npm run check"], "belowEditor")],
      placement: "belowEditor",
    }));

    expect(markup).toContain('aria-label="消息编辑器下方的扩展小组件"');
    expect(markup).toContain('aria-label="扩展小组件 build"');
    expect(markup).toContain("npm run check");
  });
});
