import { describe, expect, it } from "vitest";
import type { ExtensionUIRequestEvent } from "./types";
import { parseExtensionUIEffect } from "./extensionUIEffects";

function request(method: string, fields: Record<string, unknown> = {}): ExtensionUIRequestEvent {
  return { type: "extension_ui_request", id: "request-id", method, ...fields };
}

describe("extension UI effects", () => {
  it("normalizes notifications and rejects empty messages", () => {
    expect(parseExtensionUIEffect(request("notify", { message: "Finished", notifyType: "warning" }))).toEqual({
      kind: "notify",
      message: "Finished",
      notificationType: "warning",
    });
    expect(parseExtensionUIEffect(request("notify", { message: "" }))).toBeNull();
  });

  it("parses status updates and explicit clears", () => {
    expect(parseExtensionUIEffect(request("setStatus", { statusKey: "deploy", statusText: "Uploading" }))).toEqual({
      kind: "status",
      key: "deploy",
      text: "Uploading",
    });
    expect(parseExtensionUIEffect(request("setStatus", { statusKey: "deploy" }))).toEqual({
      kind: "status",
      key: "deploy",
      text: undefined,
    });
  });

  it("copies valid widget lines and normalizes placement", () => {
    const lines = ["one", "two"];
    expect(parseExtensionUIEffect(request("setWidget", { widgetKey: "tasks", widgetLines: lines }))).toEqual({
      kind: "widget",
      key: "tasks",
      lines,
      placement: "aboveEditor",
    });
    expect(parseExtensionUIEffect(request("setWidget", { widgetKey: "tasks", widgetLines: [1] }))).toBeNull();
  });

  it("parses title and editor text without treating dialog requests as effects", () => {
    expect(parseExtensionUIEffect(request("setTitle", { title: "Deploying" }))).toEqual({
      kind: "title",
      title: "Deploying",
    });
    expect(parseExtensionUIEffect(request("set_editor_text", { text: "prefill" }))).toEqual({
      kind: "editorText",
      text: "prefill",
    });
    expect(parseExtensionUIEffect(request("input", { title: "Name" }))).toBeNull();
  });
});
