import {
  useLayoutEffect,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useI18n } from "../../i18n";
import { useStore } from "../../store";
import * as api from "../../ipc/api";
import { PermissionSelector } from "../PermissionSelector";
import { ModelSelector } from "../ModelSelector";
import { ContextMeter } from "../ContextMeter";
import { Icon } from "../Icon";
import { ExtensionWidgets } from "../ExtensionWidgets";
import { InlineApproval, isInteractiveExtensionUIRequest } from "../Message/InlineApproval";
import { showToast } from "../Toast";
import { approvalHistoryLabel } from "../../store/approvalHistory";
import {
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_MEGABYTES,
  ImageAttachmentError,
  appendAttachments,
  getTransferredFiles,
  getPromptText,
  readImageAttachment,
  toImageContent,
  type ComposerAttachment,
} from "./attachments";
import {
  isPromptSubmissionBlocked,
  resolvePromptStreamingBehavior,
  shouldSubmitComposerEnter,
  type StreamingSubmitMode,
} from "./submission";
import {
  clearComposerWorkspaceDraft,
  getComposerWorkspaceDraftKey,
  getComposerWorkspaceDraft,
  setComposerWorkspaceDraft,
} from "./workspaceDrafts";

type Suggestion =
  | { kind: "command"; value: string; label: string; description?: string }
  | { kind: "file"; value: string; label: string };

// Extracts the active `/command` or `@file` token immediately before the cursor.
function getActiveToken(text: string, caret: number): { trigger: "/" | "@"; query: string; start: number } | null {
  const upto = text.slice(0, caret);
  // Slash command only triggers at the very start of the input.
  const slashMatch = /^\/(\S*)$/.exec(upto);
  if (slashMatch) {
    return { trigger: "/", query: slashMatch[1], start: 0 };
  }
  // @file triggers anywhere, on a whitespace-delimited token.
  const atMatch = /(?:^|\s)@(\S*)$/.exec(upto);
  if (atMatch) {
    const start = upto.lastIndexOf("@");
    return { trigger: "@", query: atMatch[1], start };
  }
  return null;
}

export function Composer() {
  const { resolvedLanguage, t } = useI18n();
  const suggestionsListboxId = useId();
  const workspaceCwd = useStore((state) => state.workspaceCwd);
  const sessionId = useStore((state) => state.session?.sessionId ?? null);
  const composerContextKey = getComposerWorkspaceDraftKey(workspaceCwd, sessionId);
  const composerContextRef = useRef({ key: composerContextKey, cwd: workspaceCwd, sessionId });
  const pendingTextareaResizeRef = useRef<string | null>(null);
  const [input, setInput] = useState(() => getComposerWorkspaceDraft(workspaceCwd, sessionId).input);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>(
    () => getComposerWorkspaceDraft(workspaceCwd, sessionId).attachments,
  );
  const [readingAttachments, setReadingAttachments] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [streamingSubmitMode, setStreamingSubmitMode] = useState<StreamingSubmitMode>("follow-up");
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [fileMatches, setFileMatches] = useState<string[]>([]);
  const isStreaming = useStore((s) => s.isStreaming);
  const retrying = useStore((s) => s.retryActivity !== null || Boolean(s.session?.isRetrying));
  const compacting = useStore((s) => s.compactionActivity !== null || Boolean(s.session?.isCompacting));
  const backendStatus = useStore((s) => s.backendStatus);
  const workspaceLoading = useStore((s) => s.workspaceLoading);
  const commands = useStore((s) => s.commands);
  const extensionWidgets = useStore((s) => s.extensionWidgets);
  const extensionUIRequests = useStore((s) => s.extensionUIRequests);
  const approvalHistory = useStore((s) => s.approvalHistory);
  const modelSupportsImages = useStore((s) => s.session?.model?.input.includes("image") ?? true);
  const composerDraft = useStore((s) => s.composerDraft);
  const setComposerDraft = useStore((s) => s.setComposerDraft);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileRequestSeq = useRef(0);
  const attachmentRequestSeq = useRef(0);
  const dragDepthRef = useRef(0);

  const token = getActiveToken(input, input.length);
  const approvalRequests = useMemo(
    () => extensionUIRequests.filter(isInteractiveExtensionUIRequest),
    [extensionUIRequests],
  );

  useLayoutEffect(() => {
    const previousContext = composerContextRef.current;
    if (previousContext.key !== composerContextKey) {
      setComposerWorkspaceDraft(previousContext.cwd, previousContext.sessionId, input, attachments);
      const draft = getComposerWorkspaceDraft(workspaceCwd, sessionId);
      composerContextRef.current = { key: composerContextKey, cwd: workspaceCwd, sessionId };
      pendingTextareaResizeRef.current = composerContextKey;
      setInput(draft.input);
      setAttachments(draft.attachments);
      setReadingAttachments(false);
      setSubmitting(false);
      setStreamingSubmitMode("follow-up");
      setDraggingFiles(false);
      setMenuOpen(false);
      setActiveIndex(0);
      setFileMatches([]);
      dragDepthRef.current = 0;
      fileRequestSeq.current += 1;
      attachmentRequestSeq.current += 1;
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      return;
    }
    if (pendingTextareaResizeRef.current === composerContextKey) {
      pendingTextareaResizeRef.current = null;
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.style.height = "auto";
        textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
      }
    }
    setComposerWorkspaceDraft(workspaceCwd, sessionId, input, attachments);
  }, [attachments, composerContextKey, input, sessionId, workspaceCwd]);

  useEffect(() => {
    const focusFrame = requestAnimationFrame(() => {
      if (document.activeElement !== document.body) return;
      if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
      textareaRef.current?.focus();
    });
    return () => cancelAnimationFrame(focusFrame);
  }, []);

  // Consume a draft pushed from elsewhere (e.g. empty-state action cards):
  // prefill the input, focus, size to fit, then clear the shared draft.
  useEffect(() => {
    if (composerDraft == null) return;
    setInput((current) => typeof composerDraft === "function" ? composerDraft(current) : composerDraft);
    setComposerDraft(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    });
  }, [composerDraft, setComposerDraft]);

  // Fetch workspace files when an @token is active.
  useEffect(() => {
    if (!token || token.trigger !== "@") {
      setFileMatches([]);
      return;
    }
    const seq = ++fileRequestSeq.current;
    void api
      .listWorkspaceFiles(token.query)
      .then((files) => {
        if (seq === fileRequestSeq.current) setFileMatches(files.slice(0, 20));
      })
      .catch(() => {
        if (seq === fileRequestSeq.current) setFileMatches([]);
      });
  }, [token?.trigger, token?.query]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!token) return [];
    if (token.trigger === "/") {
      const q = token.query.toLowerCase();
      return commands
        .filter((c) => c.name.toLowerCase().includes(q))
        .slice(0, 30)
        .map((c) => ({ kind: "command", value: `/${c.name}`, label: c.name, description: c.description }));
    }
    return fileMatches.map((f) => ({ kind: "file", value: f, label: f }));
  }, [token?.trigger, token?.query, commands, fileMatches]);

  useEffect(() => {
    setMenuOpen(suggestions.length > 0);
    setActiveIndex(0);
  }, [suggestions.length, token?.trigger, token?.query]);

  function autosize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  function applySuggestion(suggestion: Suggestion) {
    if (!token) return;
    let next: string;
    if (suggestion.kind === "command") {
      next = `${suggestion.value} `;
    } else {
      // Replace the @token span with the picked file path.
      next = `${input.slice(0, token.start)}@${suggestion.value} `;
    }
    setInput(next);
    setMenuOpen(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      autosize();
    });
  }

  async function submit(message: string, images: ReturnType<typeof toImageContent> | undefined) {
    await api.sendPrompt(message, images, resolvePromptStreamingBehavior(isStreaming, message, streamingSubmitMode));
  }

  async function addAttachmentFiles(selectedFiles: readonly File[]) {
    if (selectedFiles.length === 0) return;
    if (!modelSupportsImages) {
      showToast(t("The current model does not support image input", "当前模型不支持图片输入"), "error");
      return;
    }
    if (submitting || readingAttachments) {
      showToast(t("Wait for the current message or images to finish processing", "请等待当前消息或图片处理完成"), "info");
      return;
    }

    const availableSlots = Math.max(0, MAX_ATTACHMENT_COUNT - attachments.length);
    if (availableSlots === 0) {
      showToast(t("You can attach up to {count} images", "最多可附加 {count} 张图片", {
        count: MAX_ATTACHMENT_COUNT,
      }), "error");
      return;
    }

    setReadingAttachments(true);
    const requestKey = composerContextKey;
    const requestSeq = ++attachmentRequestSeq.current;
    try {
      const filesToRead = selectedFiles.slice(0, availableSlots);
      const results = await Promise.allSettled(filesToRead.map((file) => readImageAttachment(file)));
      if (requestSeq !== attachmentRequestSeq.current || composerContextRef.current.key !== requestKey) return;
      const accepted = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
      const errors = results.flatMap((result) =>
        result.status === "rejected"
          ? [result.reason instanceof ImageAttachmentError
              ? result.reason.reason === "unsupported"
                ? t("{name} is not a supported image", "{name} 不是受支持的图片", {
                    name: result.reason.attachmentName,
                  })
                : t("{name} exceeds the {size} MB attachment limit", "{name} 超出 {size} MB 的附件上限", {
                    name: result.reason.attachmentName,
                    size: MAX_ATTACHMENT_MEGABYTES,
                  })
              : result.reason instanceof Error
                ? result.reason.message
                : String(result.reason)]
          : [],
      );
      setAttachments((current) => appendAttachments(current, accepted).attachments);

      const dropped = selectedFiles.length - filesToRead.length;
      if (errors.length > 0) {
        const suffix = errors.length > 1
          ? t(" (+{count} more)", "（另有 {count} 个）", { count: errors.length - 1 })
          : "";
        showToast(`${errors[0]}${suffix}`, "error");
      }
      if (dropped > 0) {
        showToast(t("Only the first {count} images were attached", "仅附加了前 {count} 张图片", {
          count: availableSlots,
        }), "info");
      }
    } finally {
      if (requestSeq === attachmentRequestSeq.current && composerContextRef.current.key === requestKey) {
        setReadingAttachments(false);
      }
    }
  }

  function handleAttachmentSelection(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    void addAttachmentFiles(selectedFiles);
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pastedFiles = getTransferredFiles(event.clipboardData);
    if (pastedFiles.length === 0) return;
    event.preventDefault();
    void addAttachmentFiles(pastedFiles);
  }

  function handleDragEnter(event: DragEvent<HTMLFormElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDraggingFiles(true);
  }

  function handleDragOver(event: DragEvent<HTMLFormElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: DragEvent<HTMLFormElement>) {
    if (dragDepthRef.current === 0) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDraggingFiles(false);
  }

  function handleDrop(event: DragEvent<HTMLFormElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setDraggingFiles(false);
    void addAttachmentFiles(getTransferredFiles(event.dataTransfer));
  }

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (!backendStatus.ready) {
      showToast(
        backendStatus.error
          ? t("Agent unavailable: {error}", "智能体不可用：{error}", { error: backendStatus.error })
          : t("The agent is not ready yet", "智能体尚未就绪"),
        "error",
      );
      return;
    }
    const current = useStore.getState();
    const retryBlocked = current.retryActivity !== null || Boolean(current.session?.isRetrying);
    const compactionBlocked = current.compactionActivity !== null || Boolean(current.session?.isCompacting);
    if (isPromptSubmissionBlocked(retryBlocked, compactionBlocked)) {
      showToast(
        t("Wait for retry or compaction to finish.", "请等待重试或压缩完成。"),
        "warning",
      );
      return;
    }
    const message = input.trim();
    if ((!message && attachments.length === 0) || submitting || readingAttachments) return;
    if (attachments.length > 0 && !modelSupportsImages) {
      showToast(t("The current model does not support image input", "当前模型不支持图片输入"), "error");
      return;
    }
    const requestKey = composerContextKey;
    setSubmitting(true);
    try {
      const images = toImageContent(attachments);
      await submit(getPromptText(message, images.length), images.length > 0 ? images : undefined);
      if (composerContextRef.current.key !== requestKey) return;
      clearComposerWorkspaceDraft(workspaceCwd, sessionId);
      setInput("");
      setAttachments([]);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    } catch (error) {
      if (composerContextRef.current.key !== requestKey) return;
      showToast(t("Failed to send message: {error}", "发送消息失败：{error}", {
        error: error instanceof Error ? error.message : String(error),
      }), "error");
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        autosize();
      });
    } finally {
      if (composerContextRef.current.key === requestKey) setSubmitting(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const shouldSubmit = shouldSubmitComposerEnter(e.key, e.shiftKey, e.nativeEvent.isComposing);
    if (menuOpen && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        applySuggestion(suggestions[activeIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMenuOpen(false);
        return;
      }
      if (shouldSubmit && suggestions[activeIndex]) {
        e.preventDefault();
        applySuggestion(suggestions[activeIndex]);
        return;
      }
    }
    if (shouldSubmit) {
      e.preventDefault();
      handleSubmit();
    }
  }

  async function handleAbort() {
    try {
      await api.abort();
    } catch (error) {
      showToast(t("Failed to stop generation: {error}", "停止生成失败：{error}", {
        error: error instanceof Error ? error.message : String(error),
      }), "error");
    }
  }

  const isSlashCommand = input.trimStart().startsWith("/");
  const streamingSubmitLabel = isSlashCommand
    ? t("Run command", "运行命令")
    : streamingSubmitMode === "steer"
      ? t("Steer current run", "引导当前运行")
      : t("Queue follow-up", "加入跟进队列");
  const inputPlaceholder = backendStatus.ready
    ? t("Send a message...", "发送消息…")
    : backendStatus.starting || backendStatus.restarting
      ? t("Write while the agent starts...", "智能体启动中，可先输入…")
      : t("Write a draft...", "输入草稿…");

  return (
    <div className="composer-wrap">
      <ExtensionWidgets widgets={extensionWidgets} placement="aboveEditor" />
      {approvalRequests.length > 0 && (
        <div className="composer-approval-stack">
          {approvalRequests.map((request) => (
            <InlineApproval key={request.id} request={request} />
          ))}
        </div>
      )}
      {approvalHistory.length > 0 && approvalRequests.length === 0 && (
        <div className="composer-approval-history" role="group" aria-label={t("Recent approvals", "最近审批")}>
          {approvalHistory.slice(-3).reverse().map((entry) => (
            <div className={`approval-history-item decision-${entry.decision}`} key={entry.id} title={entry.method}>
              {approvalHistoryLabel(entry, resolvedLanguage === "zh-CN" ? "zh-CN" : "en")}
            </div>
          ))}
        </div>
      )}
      <form
        className={`composer ${draggingFiles ? "drag-active" : ""}`}
        onSubmit={handleSubmit}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {draggingFiles && (
          <div
            className={`composer-drop-overlay ${modelSupportsImages ? "" : "unsupported"}`}
            role="status"
            aria-live="polite"
          >
            <span className="composer-drop-title">
              {modelSupportsImages
                ? t("Drop images to attach", "拖放图片以附加")
                : t("This model cannot accept images", "此模型无法接收图片")}
            </span>
            <span className="composer-drop-description">
              {t(
                "PNG, JPEG, GIF, or WebP; up to {count} images; {size} MB each",
                "支持 PNG、JPEG、GIF 或 WebP；最多 {count} 张；每张 {size} MB",
                { count: MAX_ATTACHMENT_COUNT, size: MAX_ATTACHMENT_MEGABYTES },
              )}
            </span>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="composer-attachments" role="group" aria-label={t("Image attachments", "图片附件")}>
            {attachments.map((attachment) => (
              <div className="composer-attachment" key={attachment.id}>
                <img
                  src={`data:${attachment.mimeType};base64,${attachment.data}`}
                  alt={attachment.name}
                  title={attachment.name}
                />
                <button
                  className="composer-attachment-remove"
                  type="button"
                  aria-label={t("Remove {name}", "移除 {name}", { name: attachment.name })}
                  title={t("Remove image", "移除图片")}
                  disabled={submitting}
                  onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="composer-input-wrap">
          {menuOpen && suggestions.length > 0 && (
            <div
              id={suggestionsListboxId}
              className="composer-suggestions"
              role="listbox"
              aria-label={token?.trigger === "/" ? t("Commands", "命令") : t("Workspace files", "工作区文件")}
            >
              {suggestions.map((s, i) => (
                <button
                  id={`${suggestionsListboxId}-${i}`}
                  key={`${s.kind}:${s.value}`}
                  type="button"
                  role="option"
                  aria-selected={i === activeIndex}
                  className={`composer-suggestion ${i === activeIndex ? "active" : ""}`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applySuggestion(s);
                  }}
                >
                  <span className="composer-suggestion-icon" aria-hidden="true">
                    {s.kind === "command" ? "/" : "@"}
                  </span>
                  <span className="composer-suggestion-label">{s.label}</span>
                  {s.kind === "command" && s.description && (
                    <span className="composer-suggestion-desc">{s.description}</span>
                  )}
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            className="composer-input"
            value={input}
            onChange={(e) => { setInput(e.target.value); autosize(); }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={inputPlaceholder}
            rows={1}
            role="combobox"
            aria-autocomplete="list"
            aria-controls={menuOpen ? suggestionsListboxId : undefined}
            aria-expanded={menuOpen}
            aria-activedescendant={menuOpen && suggestions[activeIndex] ? `${suggestionsListboxId}-${activeIndex}` : undefined}
            aria-label={t("Message input", "消息输入框")}
            aria-describedby="composer-image-attachment-hint"
            disabled={submitting}
          />
          <span className="composer-a11y-description" id="composer-image-attachment-hint">
            {t(
              "Paste or drop PNG, JPEG, GIF, or WebP images to attach them. Up to {count} images, {size} megabytes each.",
              "粘贴或拖放 PNG、JPEG、GIF 或 WebP 图片以附加。最多 {count} 张，每张 {size} MB。",
              { count: MAX_ATTACHMENT_COUNT, size: MAX_ATTACHMENT_MEGABYTES },
            )}
          </span>
        </div>
        <div className="composer-footer">
          <div className="composer-toolbar">
            <input
              ref={fileInputRef}
              className="composer-file-input"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              tabIndex={-1}
              onChange={handleAttachmentSelection}
            />
            <button
              className="composer-attach-btn"
              type="button"
              aria-label={t("Attach images", "附加图片")}
              title={modelSupportsImages
                ? t("Attach images", "附加图片")
                : t("Current model does not support images", "当前模型不支持图片")}
              disabled={submitting || readingAttachments || !modelSupportsImages}
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon name="paperclip" size={18} />
            </button>
            <PermissionSelector />
          </div>
          <div className="composer-footer-end">
            {!workspaceLoading && <ContextMeter />}
            <div className={`composer-model-slot ${workspaceLoading ? "loading" : ""}`} inert={workspaceLoading}>
              <ModelSelector />
            </div>
            <div className="composer-actions">
              {isStreaming && (
                <>
                  <label className="composer-streaming-mode">
                    <span className="composer-a11y-description">
                      {t("Send behavior during the current run", "当前运行期间的发送方式")}
                    </span>
                    <select
                      value={streamingSubmitMode}
                      onChange={(event) => setStreamingSubmitMode(event.target.value as StreamingSubmitMode)}
                      title={
                        streamingSubmitMode === "steer"
                          ? t("Add guidance before the agent's next model step", "在智能体下一次模型调用前添加引导")
                          : t("Run this message after the current task finishes", "当前任务完成后运行此消息")
                      }
                    >
                      <option value="follow-up">{t("Queue follow-up", "跟进消息入队")}</option>
                      <option value="steer">{t("Steer current run", "引导当前运行")}</option>
                    </select>
                  </label>
                  <button
                    className="composer-abort-btn"
                    type="button"
                    onClick={handleAbort}
                    aria-label={t("Stop generating", "停止生成")}
                  >
                    <span className="composer-abort-icon" aria-hidden="true" />
                    <span>{t("Stop", "停止")}</span>
                  </button>
                </>
              )}
              <button
                className={`composer-send-btn ${isStreaming ? "queue-mode" : ""}`}
                type="submit"
                disabled={
                  submitting ||
                  readingAttachments ||
                  !backendStatus.ready ||
                  isPromptSubmissionBlocked(retrying, compacting) ||
                  (!input.trim() && attachments.length === 0) ||
                  (attachments.length > 0 && !modelSupportsImages)
                }
                aria-label={isStreaming ? streamingSubmitLabel : t("Send message", "发送消息")}
                title={
                  !backendStatus.ready
                    ? t("The agent backend is not ready", "智能体后端尚未就绪")
                    : retrying
                      ? t("Wait for the automatic retry to finish or cancel it", "请等待自动重试完成或取消重试")
                    : compacting
                      ? t("Wait for compaction to finish", "请等待压缩完成")
                    : isStreaming
                      ? t("{action} (Enter)", "{action}（Enter）", { action: streamingSubmitLabel })
                      : t("Send message (Enter)", "发送消息（Enter）")
                }
              >
                {isStreaming ? (
                  <Icon name="queue" size={17} strokeWidth={1.8} />
                ) : (
                  <Icon name="send" size={17} strokeWidth={2} />
                )}
              </button>
            </div>
          </div>
        </div>
      </form>
      <ExtensionWidgets widgets={extensionWidgets} placement="belowEditor" />
    </div>
  );
}
