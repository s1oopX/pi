import { describe, expect, it } from "vitest";
import { planConversationLayout } from "./conversationLayout";

describe("planConversationLayout", () => {
  it("pins status to the sticky footer when session stats exist", () => {
    expect(planConversationLayout({
      hasStatusContent: true,
      hasQueued: false,
      hasExtensionStatuses: false,
      isStreaming: false,
    })).toEqual({
      showStickyStatus: true,
      showInlineStatusRow: false,
    });
  });

  it("keeps queue/extension rows inline even with sticky stats", () => {
    expect(planConversationLayout({
      hasStatusContent: true,
      hasQueued: true,
      hasExtensionStatuses: false,
      isStreaming: true,
    })).toEqual({
      showStickyStatus: true,
      showInlineStatusRow: true,
    });
  });

  it("hides sticky status when there is nothing to show", () => {
    expect(planConversationLayout({
      hasStatusContent: false,
      hasQueued: false,
      hasExtensionStatuses: false,
      isStreaming: false,
    })).toEqual({
      showStickyStatus: false,
      showInlineStatusRow: false,
    });
  });
});
