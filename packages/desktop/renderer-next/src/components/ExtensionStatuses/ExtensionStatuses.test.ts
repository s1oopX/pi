import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { setLanguagePreference } from "../../i18n";
import { ExtensionStatuses, sanitizeExtensionStatusText } from "./ExtensionStatuses";

beforeEach(() => setLanguagePreference("en", null));

describe("extension statuses", () => {
  it("renders non-empty statuses as escaped live text", () => {
    const markup = renderToStaticMarkup(createElement(ExtensionStatuses, {
      statuses: { deploy: "Uploading <script>", empty: " " },
    }));

    expect(markup).toContain('aria-label="Extension status"');
    expect(markup).toContain('title="deploy"');
    expect(markup).toContain("Uploading &lt;script&gt;");
    expect(markup).not.toContain("title=\"empty\"");
  });

  it("removes ANSI sequences and collapses single-line control characters", () => {
    expect(sanitizeExtensionStatusText("\u001b[32mReady\u001b[0m\r\nnext\tstep\u0007")).toBe("Ready next step");

    const markup = renderToStaticMarkup(createElement(ExtensionStatuses, {
      statuses: { deploy: "\u001b]8;;https://example.test\u0007Docs\u001b]8;;\u0007" },
    }));
    expect(markup).toContain(">Docs</span>");
    expect(markup).not.toContain("example.test");
  });

  it("renders nothing without visible status text", () => {
    expect(renderToStaticMarkup(createElement(ExtensionStatuses, { statuses: { task: "" } }))).toBe("");
  });

  it("localizes its accessible label without changing extension text", () => {
    setLanguagePreference("zh-CN", null);
    const markup = renderToStaticMarkup(createElement(ExtensionStatuses, {
      statuses: { deploy: "Uploading" },
    }));

    expect(markup).toContain('aria-label="扩展状态"');
    expect(markup).toContain(">Uploading</span>");
  });
});
