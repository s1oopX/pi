import type { ExtensionUIRequestEvent } from "./types";

export type ExtensionNotificationType = "info" | "warning" | "error";
export type ExtensionWidgetPlacement = "aboveEditor" | "belowEditor";

export type ExtensionUIEffect =
  | { kind: "notify"; message: string; notificationType: ExtensionNotificationType }
  | { kind: "status"; key: string; text: string | undefined }
  | { kind: "widget"; key: string; lines: string[] | undefined; placement: ExtensionWidgetPlacement }
  | { kind: "title"; title: string }
  | { kind: "editorText"; text: string };

const INTERACTIVE_EXTENSION_UI_METHODS = new Set(["confirm", "select", "input", "editor"]);

export function isInteractiveExtensionUIRequest(event: ExtensionUIRequestEvent): boolean {
  return INTERACTIVE_EXTENSION_UI_METHODS.has(event.method);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function parseExtensionUIEffect(event: ExtensionUIRequestEvent): ExtensionUIEffect | null {
  switch (event.method) {
    case "notify": {
      const message = nonEmptyString(event.message);
      if (!message) return null;
      const notificationType = event.notifyType === "warning" || event.notifyType === "error"
        ? event.notifyType
        : "info";
      return { kind: "notify", message, notificationType };
    }
    case "setStatus": {
      const key = nonEmptyString(event.statusKey);
      if (!key || (event.statusText !== undefined && typeof event.statusText !== "string")) return null;
      return { kind: "status", key, text: event.statusText };
    }
    case "setWidget": {
      const key = nonEmptyString(event.widgetKey);
      if (!key) return null;
      const lines = event.widgetLines;
      if (lines !== undefined && (!Array.isArray(lines) || !lines.every((line) => typeof line === "string"))) {
        return null;
      }
      const placement = event.widgetPlacement === "belowEditor" ? "belowEditor" : "aboveEditor";
      return { kind: "widget", key, lines: lines === undefined ? undefined : [...lines], placement };
    }
    case "setTitle": {
      const title = nonEmptyString(event.title);
      return title ? { kind: "title", title } : null;
    }
    case "set_editor_text":
      return typeof event.text === "string" ? { kind: "editorText", text: event.text } : null;
    default:
      return null;
  }
}
