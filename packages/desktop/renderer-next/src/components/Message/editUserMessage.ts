import { translateText, type ResolvedLanguage } from "../../i18n";
import * as api from "../../ipc/api";
import { useStore } from "../../store";
import { showToast } from "../Toast";
import type { Message } from "../../ipc/types";
import { resolveForkEntryId } from "./forkEntry";

type RewindMode = "edit" | "retry";

// Orchestrates "edit and resend" for a user message. Reuses the proven fork
// flow from the branch navigator: fork-before the target user message truncates
// the session to just before it and returns its original text, which we drop
// back into the composer for the user to edit and resend.
//
// The message list carries no entry id, so the target is located by reference
// in the current store snapshot and mapped to a fork entry via resolveForkEntryId.
// The button is disabled while the agent runs, so the snapshot is stable across
// this async flow.
async function rewindUserMessage(message: Message, language: ResolvedLanguage, mode: RewindMode): Promise<void> {
  const t = (english: string, simplifiedChinese: string, values?: Record<string, string | number>) =>
    translateText(language, english, simplifiedChinese, values);
  const operation = mode === "retry"
    ? { english: "retry message", simplifiedChinese: "重试消息" }
    : { english: "edit message", simplifiedChinese: "编辑消息" };

  const state = useStore.getState();
  if (state.isStreaming || state.compactionActivity !== null || Boolean(state.session?.isCompacting)) {
    showToast(t(
      "Finish or stop the current run before editing or retrying a message.",
      "请先完成或停止当前运行，再编辑或重试消息。",
    ), "warning");
    return;
  }

  const targetIndex = state.messages.indexOf(message);
  if (targetIndex < 0) return;

  let forkMessages: Awaited<ReturnType<typeof api.getForkMessages>>;
  try {
    forkMessages = await api.getForkMessages();
  } catch (error) {
    showToast(t("Failed to {operation}: {error}", "{operation}失败：{error}", {
      operation: t(operation.english, operation.simplifiedChinese),
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
    showToast(t("This message can no longer be edited or retried.", "此消息已无法编辑或重试。"), "error");
    return;
  }

  try {
    const result = await api.forkSession(entryId);
    if (result.cancelled) return;
    // resetForWorkspace clears any composer draft, so set the recovered text
    // only after the reset (and its refresh) settles.
    await useStore.getState().resetForWorkspace(useStore.getState().workspaceCwd);
    if (mode === "edit") {
      useStore.getState().setComposerDraft(result.text);
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".composer-input")?.focus());
      return;
    }

    const images = message.role === "user" && Array.isArray(message.content)
      ? message.content.filter((block) => block.type === "image")
      : [];
    try {
      await api.sendPrompt(result.text, images.length > 0 ? images : undefined);
    } catch (error) {
      useStore.getState().setComposerDraft(result.text);
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".composer-input")?.focus());
      throw error;
    }
  } catch (error) {
    showToast(t("Failed to {operation}: {error}", "{operation}失败：{error}", {
      operation: t(operation.english, operation.simplifiedChinese),
      error: error instanceof Error ? error.message : String(error),
    }), "error");
  }
}

export function beginEditUserMessage(message: Message, language: ResolvedLanguage): Promise<void> {
  return rewindUserMessage(message, language, "edit");
}

export async function retryAssistantMessage(message: Message, language: ResolvedLanguage): Promise<void> {
  const messages = useStore.getState().messages;
  const errorIndex = messages.indexOf(message);
  for (let index = errorIndex - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate.role === "user") {
      await rewindUserMessage(candidate, language, "retry");
      return;
    }
  }

  showToast(
    translateText(language, "No user message is available to retry.", "没有可重试的用户消息。"),
    "error",
  );
}
