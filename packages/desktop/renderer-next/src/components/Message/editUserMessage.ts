import { translateText, type ResolvedLanguage } from "../../i18n";
import * as api from "../../ipc/api";
import { useStore } from "../../store";
import { showToast } from "../Toast";
import type { Message } from "../../ipc/types";
import { resolveForkEntryId } from "./forkEntry";

// Orchestrates "edit and resend" for a user message. Reuses the proven fork
// flow from the branch navigator: fork-before the target user message truncates
// the session to just before it and returns its original text, which we drop
// back into the composer for the user to edit and resend.
//
// The message list carries no entry id, so the target is located by reference
// in the current store snapshot and mapped to a fork entry via resolveForkEntryId.
// The button is disabled while the agent runs, so the snapshot is stable across
// this async flow.
export async function beginEditUserMessage(message: Message, language: ResolvedLanguage): Promise<void> {
  const t = (english: string, simplifiedChinese: string, values?: Record<string, string | number>) =>
    translateText(language, english, simplifiedChinese, values);

  const state = useStore.getState();
  if (state.isStreaming || state.compactionActivity !== null || Boolean(state.session?.isCompacting)) {
    showToast(t("Finish or stop the current run before editing a message.", "请先完成或停止当前运行，再编辑消息。"), "warning");
    return;
  }

  const targetIndex = state.messages.indexOf(message);
  if (targetIndex < 0) return;

  let forkMessages: Awaited<ReturnType<typeof api.getForkMessages>>;
  try {
    forkMessages = await api.getForkMessages();
  } catch (error) {
    showToast(t("Failed to edit message: {error}", "编辑消息失败：{error}", {
      error: error instanceof Error ? error.message : String(error),
    }), "error");
    return;
  }

  // The snapshot may have advanced between reads; re-resolve against the latest.
  const current = useStore.getState();
  const liveIndex = current.messages.indexOf(message);
  if (liveIndex < 0 || current.isStreaming) return;
  const entryId = resolveForkEntryId(current.messages, forkMessages, liveIndex);
  if (!entryId) {
    showToast(t("This message can no longer be edited.", "此消息已无法编辑。"), "error");
    return;
  }

  try {
    const result = await api.forkSession(entryId);
    if (result.cancelled) return;
    // resetForWorkspace clears any composer draft, so set the recovered text
    // only after the reset (and its refresh) settles.
    await useStore.getState().resetForWorkspace(useStore.getState().workspaceCwd);
    useStore.getState().setComposerDraft(result.text);
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".composer-input")?.focus());
  } catch (error) {
    showToast(t("Failed to edit message: {error}", "编辑消息失败：{error}", {
      error: error instanceof Error ? error.message : String(error),
    }), "error");
  }
}
