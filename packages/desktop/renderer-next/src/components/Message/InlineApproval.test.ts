import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLanguagePreference } from "../../i18n";
import type { ExtensionUIRequestEvent } from "../../ipc/types";
import {
  InlineApproval,
  createCancelledApprovalResponse,
  createTextApprovalResponse,
  isInteractiveExtensionUIRequest,
} from "./InlineApproval";

function request(method: string, fields: Record<string, unknown> = {}): ExtensionUIRequestEvent {
  return { type: "extension_ui_request", id: `${method}-1`, method, ...fields };
}

beforeEach(() => setLanguagePreference("en", null));
afterEach(() => setLanguagePreference("en", null));

describe("extension UI request routing", () => {
  it("keeps every backend-blocking dialog method visible", () => {
    expect(["confirm", "select", "input", "editor"].map((method) =>
      isInteractiveExtensionUIRequest(request(method)),
    )).toEqual([true, true, true, true]);
    expect(isInteractiveExtensionUIRequest(request("notify"))).toBe(false);
    expect(isInteractiveExtensionUIRequest(request("setStatus"))).toBe(false);
  });

  it("uses the RPC response shapes expected by input and editor requests", () => {
    expect(createTextApprovalResponse("feature/name")).toEqual({ value: "feature/name" });
    expect(createCancelledApprovalResponse()).toEqual({ cancelled: true });
  });
});

describe("InlineApproval text dialogs", () => {
  it("renders an accessible single-line input with cancel and submit actions", () => {
    const markup = renderToStaticMarkup(createElement(InlineApproval, {
      request: request("input", { title: "Branch name", placeholder: "feature/name" }),
    }));

    expect(markup).toContain('role="alertdialog"');
    expect(markup).toContain("aria-labelledby=");
    expect(markup).toContain('aria-label="Branch name"');
    expect(markup).toContain('placeholder="feature/name"');
    expect(markup).toContain(">Cancel</button>");
    expect(markup).toContain(">Submit</button>");
  });

  it("renders editor prefill in a multiline field with its keyboard hint", () => {
    const markup = renderToStaticMarkup(createElement(InlineApproval, {
      request: request("editor", { title: "Edit release notes", prefill: "Draft notes" }),
    }));

    expect(markup).toContain("<textarea");
    expect(markup).toContain("Draft notes</textarea>");
    expect(markup).toContain("Ctrl/Cmd+Enter to submit");
    expect(markup).toContain("Escape to cancel");
  });

  it("localizes application-provided defaults without translating extension content", () => {
    setLanguagePreference("zh-CN", null);
    const markup = renderToStaticMarkup(createElement(InlineApproval, {
      request: request("confirm", { message: "npm install" }),
    }));

    expect(markup).toContain("批准此操作？");
    expect(markup).toContain(">拒绝</button>");
    expect(markup).toContain(">允许</button>");
    expect(markup).toContain("npm install");
  });
});
