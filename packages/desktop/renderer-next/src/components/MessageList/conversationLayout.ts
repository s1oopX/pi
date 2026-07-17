/**
 * Decide how session stats / status should be mounted relative to the message list.
 * Sticky footer keeps stats visible after the user scrolls through history.
 */

export interface ConversationLayoutInput {
  hasStatusContent: boolean;
  hasQueued: boolean;
  hasExtensionStatuses: boolean;
  isStreaming: boolean;
}

export interface ConversationLayoutPlan {
  /** Render StatusBar in a sticky footer outside the virtualizer. */
  showStickyStatus: boolean;
  /** Keep a compact status row inside the list (queue / extension only). */
  showInlineStatusRow: boolean;
}

export function planConversationLayout(input: ConversationLayoutInput): ConversationLayoutPlan {
  const hasInlineExtras = input.hasQueued || input.hasExtensionStatuses;
  // Stats/streaming chrome belongs in the sticky footer so it survives scroll.
  // Queue + extension statuses still need an in-list row near the turn tail.
  return {
    showStickyStatus: input.hasStatusContent,
    showInlineStatusRow: hasInlineExtras,
  };
}
