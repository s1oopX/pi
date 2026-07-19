import { describe, expect, it } from "vitest";
import { hasBlockingAppModal, isAppShortcutBlockedByModal } from "./useAppShortcuts";

function queryRoot(matches: readonly string[]) {
  return {
    querySelector(selector: string): unknown {
      return selector.split(", ").some((candidate) => matches.includes(candidate)) ? {} : null;
    },
  };
}

describe("app shortcut modal guard", () => {
  it("blocks shortcuts for an open native dialog", () => {
    expect(hasBlockingAppModal(queryRoot(["dialog[open]"]))).toBe(true);
  });

  it("blocks shortcuts for an ARIA modal", () => {
    expect(hasBlockingAppModal(queryRoot(['[aria-modal="true"]']))).toBe(true);
  });

  it("allows shortcuts when no modal is present", () => {
    expect(hasBlockingAppModal(queryRoot([]))).toBe(false);
  });

  it("allows the command palette toggle but blocks other commands inside it", () => {
    const root = queryRoot(["[aria-modal=\"true\"]", "[data-app-command-palette]"]);
    expect(isAppShortcutBlockedByModal(root, "open-command-palette")).toBe(false);
    expect(isAppShortcutBlockedByModal(root, "toggle-workbench")).toBe(true);
  });
});
