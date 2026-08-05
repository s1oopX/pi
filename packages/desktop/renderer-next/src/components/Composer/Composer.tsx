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
import { isActiveBackendReady } from "../../store/taskRegistry";
import { findLatestTaskGoal, findLatestTaskPlan } from "../Workbench/planState";
import { isSameWorkspace } from "../Sidebar/sidebarState";
import {
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_MEGABYTES,
  AttachmentError,
  appendAttachments,
  getTransferredFiles,
  getPromptText,
  readComposerAttachment,
  resolveImageMimeType,
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
  loadPersistedComposerWorkspaceDraft,
  setComposerWorkspaceDraft,
} from "./workspaceDrafts";

type Suggestion =
  | { kind: "command"; value: string; label: string; description?: string }
  | { kind: "file"; value: string; label: string };

// Extracts the active `/command` or `@file` token immediately before the cursor.
export function getActiveToken(
  text: string,
  caret: number,
): { trigger: "/" | "@"; query: string; start: number; end: number } | null {
  const boundedCaret = Math.max(0, Math.min(caret, text.length));
  const upto = text.slice(0, boundedCaret);
  const nextWhitespace = text.slice(boundedCaret).search(/\s/);
  const end = nextWhitespace === -1 ? text.length : boundedCaret + nextWhitespace;
  // Slash command only triggers at the very start of the input.
  const slashMatch = /^\/(\S*)$/.exec(upto);
  if (slashMatch) {
    return { trigger: "/", query: slashMatch[1], start: 0, end };
  }
  // @file triggers anywhere, on a whitespace-delimited token.
  const atMatch = /(?:^|\s)@(\S*)$/.exec(upto);
  if (atMatch) {
    const start = upto.lastIndexOf("@");
    return { trigger: "@", query: atMatch[1], start, end };
  }
  return null;
}

export function Composer() {
  const { t } = useI18n();
  const suggestionsListboxId = useId();
  const workspaceCwd = useStore((state) => state.workspaceCwd);
  const taskCwd = useStore((state) => state.taskCwd);
  const sessionId = useStore((state) => state.session?.sessionId ?? null);
  const composerContextKey = getComposerWorkspaceDraftKey(workspaceCwd, sessionId);
  const composerContextRef = useRef({ key: composerContextKey, cwd: workspaceCwd, sessionId });
  const composerHydrationRef = useRef({ key: composerContextKey, revision: 0, ready: false });
  const composerRevisionRef = useRef(0);
  const hydratedWorkspacesRef = useRef(new Set<string>());
  const pendingTextareaResizeRef = useRef<string | null>(null);
  const [input, setInput] = useState(() => getComposerWorkspaceDraft(workspaceCwd, sessionId).input);
  const [caret, setCaret] = useState(() => input.length);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>(
    () => getComposerWorkspaceDraft(workspaceCwd, sessionId).attachments,
  );
  const [readingAttachments, setReadingAttachments] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [streamingSubmitMode, setStreamingSubmitMode] = useState<StreamingSubmitMode>("follow-up");
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [fileMatches, setFileMatches] = useState<string[]>([]);
  const isStreaming = useStore((s) => s.isStreaming);
  const retrying = useStore((s) => s.retryActivity !== null || Boolean(s.session?.isRetrying));
  const compacting = useStore((s) => s.compactionActivity !== null || Boolean(s.session?.isCompacting));
  const backendStatus = useStore((s) => s.backendStatus);
  const activeBackendReady = useStore((s) => isActiveBackendReady(s.taskRegistry, s.backendStatus.ready));
  const workspaceLoading = useStore((s) => s.workspaceLoading);
  const commands = useStore((s) => s.commands);
  const extensionWidgets = useStore((s) => s.extensionWidgets);
  const extensionUIRequests = useStore((s) => s.extensionUIRequests);
  const messages = useStore((s) => s.messages);
  const modelSupportsImages = useStore((s) => s.session?.model?.input.includes("image") ?? true);
  const composerDraft = useStore((s) => s.composerDraft);
  const setComposerDraft = useStore((s) => s.setComposerDraft);
  const openSettings = useStore((s) => s.openSettings);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileRequestSeq = useRef(0);
  const attachmentRequestSeq = useRef(0);
  const dragDepthRef = useRef(0);
  const inputRef = useRef(input);
  const attachmentsRef = useRef(attachments);
  inputRef.current = input;
  attachmentsRef.current = attachments;

  const showWorkspacePicker = messages.length === 0 && !isStreaming;
  const isTaskContext = Boolean(taskCwd && isSameWorkspace(workspaceCwd, taskCwd));

  async function handleChooseWorkspace() {
    if (workspaceLoading || isStreaming) return;
    try {
      const selection = await api.chooseWorkspace();
      if (selection.changed) await useStore.getState().resetForWorkspace(selection.cwd);
    } catch (error) {
      showToast(t("Failed to choose workspace: {error}", "选择工作区失败：{error}", {
        error: error instanceof Error ? error.message : String(error),
      }), "error");
    }
  }

  const token = getActiveToken(input, caret);
  const approvalRequests = useMemo(
    () => extensionUIRequests.filter(isInteractiveExtensionUIRequest),
    [extensionUIRequests],
  );
  const taskPlan = useMemo(() => findLatestTaskPlan(messages), [messages]);
  const taskGoal = useMemo(() => findLatestTaskGoal(messages), [messages]);
  const completedPlanSteps = taskPlan?.steps.filter((step) => step.status === "completed").length ?? 0;
  const currentPlanStep = taskPlan?.steps.find((step) => step.status === "in_progress")
    ?? taskPlan?.steps.find((step) => step.status === "pending");
  const activeTaskGoal = taskGoal?.status === "active" || taskGoal?.status === "blocked" ? taskGoal : null;
  const showTaskProgress = Boolean(activeTaskGoal || currentPlanStep);

  useLayoutEffect(() => {
    const previousContext = composerContextRef.current;
    if (previousContext.key !== composerContextKey) {
      const hydration = composerHydrationRef.current;
      if (hydration.ready || composerRevisionRef.current !== hydration.revision) {
        setComposerWorkspaceDraft(previousContext.cwd, previousContext.sessionId, input, attachments);
      }
      const storedDraft = getComposerWorkspaceDraft(workspaceCwd, sessionId);
      const carryStartupDraft = previousContext.cwd === workspaceCwd && previousContext.sessionId === null && sessionId !== null
        && (input.length > 0 || attachments.length > 0)
        && !storedDraft.input && storedDraft.attachments.length === 0;
      const draft = carryStartupDraft ? { input, attachments } : storedDraft;
      if (carryStartupDraft) setComposerWorkspaceDraft(workspaceCwd, sessionId, draft.input, draft.attachments);
      composerContextRef.current = { key: composerContextKey, cwd: workspaceCwd, sessionId };
      composerHydrationRef.current = { key: composerContextKey, revision: composerRevisionRef.current, ready: false };
      pendingTextareaResizeRef.current = composerContextKey;
      setInput(draft.input);
      setCaret(draft.input.length);
      setAttachments(draft.attachments);
      setReadingAttachments(false);
      setSubmitting(false);
      setAborting(false);
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
    if (composerHydrationRef.current.ready) {
      setComposerWorkspaceDraft(workspaceCwd, sessionId, input, attachments);
    }
  }, [attachments, composerContextKey, input, sessionId, workspaceCwd]);

  useEffect(() => {
    const hydration = composerHydrationRef.current;
    if (hydration.key !== composerContextKey) return;
    const workspaceKey = workspaceCwd.trim() || "__no_workspace__";
    const memoryDraft = getComposerWorkspaceDraft(workspaceCwd, sessionId);
    if (memoryDraft.input || memoryDraft.attachments.length > 0) {
      hydration.ready = true;
      hydratedWorkspacesRef.current.add(workspaceKey);
      setComposerWorkspaceDraft(workspaceCwd, sessionId, memoryDraft.input, memoryDraft.attachments);
      return;
    }

    let cancelled = false;
    void loadPersistedComposerWorkspaceDraft(
      workspaceCwd,
      sessionId,
      !hydratedWorkspacesRef.current.has(workspaceKey),
    ).then((draft) => {
      if (cancelled || composerContextRef.current.key !== composerContextKey) return;
      const currentHydration = composerHydrationRef.current;
      if (currentHydration.key !== composerContextKey) return;
      currentHydration.ready = true;
      hydratedWorkspacesRef.current.add(workspaceKey);
      if (composerRevisionRef.current === currentHydration.revision && draft) {
        inputRef.current = draft.input;
        attachmentsRef.current = draft.attachments;
        setInput(draft.input);
        setCaret(draft.input.length);
        setAttachments(draft.attachments);
        setComposerWorkspaceDraft(workspaceCwd, sessionId, draft.input, draft.attachments);
        pendingTextareaResizeRef.current = composerContextKey;
        return;
      }
      setComposerWorkspaceDraft(workspaceCwd, sessionId, inputRef.current, attachmentsRef.current);
    });
    return () => {
      cancelled = true;
    };
  }, [composerContextKey, sessionId, workspaceCwd]);

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
    composerRevisionRef.current += 1;
    setInput((current) => typeof composerDraft === "function" ? composerDraft(current) : composerDraft);
    setComposerDraft(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      setCaret(el.value.length);
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
      const localCommands = [
        { name: "memories", description: t("Open memory settings", "打开记忆设置") },
      ];
      return [...localCommands, ...commands]
        .filter((c) => c.name.toLowerCase().includes(q))
        .slice(0, 30)
        .map((c) => ({ kind: "command", value: `/${c.name}`, label: c.name, description: c.description }));
    }
    return fileMatches.map((f) => ({ kind: "file", value: f, label: f }));
  }, [token?.trigger, token?.query, commands, fileMatches, t]);

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
    const suffix = input.slice(token.end);
    const value = suggestion.kind === "command" ? suggestion.value : `@${suggestion.value}`;
    const replacement = `${value}${suffix.length === 0 || !/^\s/.test(suffix) ? " " : ""}`;
    const next = `${input.slice(0, token.start)}${replacement}${suffix}`;
    setInput(next);
    const nextCaret = token.start + replacement.length;
    setCaret(nextCaret);
    setMenuOpen(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
      autosize();
    });
  }

  async function submit(message: string, images: ReturnType<typeof toImageContent> | undefined) {
    await api.sendPrompt(message, images, resolvePromptStreamingBehavior(isStreaming, message, streamingSubmitMode));
  }

  async function addAttachmentFiles(selectedFiles: readonly File[]) {
    if (selectedFiles.length === 0) return;
    if (submitting || readingAttachments) {
      showToast(t("Wait for the current message or files to finish processing", "请等待当前消息或文件处理完成"), "info");
      return;
    }

    const availableSlots = Math.max(0, MAX_ATTACHMENT_COUNT - attachments.length);
    if (availableSlots === 0) {
      showToast(t("You can attach up to {count} files", "最多可附加 {count} 个文件", {
        count: MAX_ATTACHMENT_COUNT,
      }), "error");
      return;
    }

    setReadingAttachments(true);
    const requestKey = composerContextKey;
    const requestSeq = ++attachmentRequestSeq.current;
    try {
      const filesToRead = selectedFiles.slice(0, availableSlots);
      const results = await Promise.allSettled(filesToRead.map((file) => {
        if (!modelSupportsImages && resolveImageMimeType(file)) {
          throw new AttachmentError("image-unsupported", file.name.trim() || "image");
        }
        return readComposerAttachment(file, api.getDroppedFilePath);
      }));
      if (requestSeq !== attachmentRequestSeq.current || composerContextRef.current.key !== requestKey) return;
      const accepted = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
      const errors = results.flatMap((result) =>
        result.status === "rejected"
          ? [result.reason instanceof AttachmentError
              ? result.reason.reason === "image-unsupported"
                ? t("The current model does not support {name}", "当前模型不支持 {name}", {
                    name: result.reason.attachmentName,
                  })
                : result.reason.reason === "path-unavailable"
                  ? t("Could not access the path for {name}", "无法访问 {name} 的文件路径", {
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
      if (accepted.length > 0) composerRevisionRef.current += 1;
      setAttachments((current) => appendAttachments(current, accepted).attachments);

      const dropped = selectedFiles.length - filesToRead.length;
      if (errors.length > 0) {
        const suffix = errors.length > 1
          ? t(" (+{count} more)", "（另有 {count} 个）", { count: errors.length - 1 })
          : "";
        showToast(`${errors[0]}${suffix}`, "error");
      }
      if (dropped > 0) {
        showToast(t("Only the first {count} files were attached", "仅附加了前 {count} 个文件", {
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
    if (input.trim() === "/memories" && attachments.length === 0 && !submitting && !readingAttachments) {
      composerRevisionRef.current += 1;
      clearComposerWorkspaceDraft(workspaceCwd, sessionId);
      setInput("");
      setCaret(0);
      openSettings("memory");
      return;
    }
    if (!activeBackendReady) {
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
    if (attachments.some((attachment) => attachment.type === "image") && !modelSupportsImages) {
      showToast(t("The current model does not support image input", "当前模型不支持图片输入"), "error");
      return;
    }
    const requestKey = composerContextKey;
    setSubmitting(true);
    try {
      const images = toImageContent(attachments);
      await submit(getPromptText(message, attachments), images.length > 0 ? images : undefined);
      composerRevisionRef.current += 1;
      clearComposerWorkspaceDraft(workspaceCwd, sessionId);
      if (composerContextRef.current.key !== requestKey) return;
      setInput("");
      setCaret(0);
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
    if (aborting) return;
    const requestContext = composerContextRef.current;
    setAborting(true);
    try {
      const queued = await api.abort();
      const restored = [...queued.steering, ...queued.followUp]
        .filter((message) => message.trim().length > 0)
        .join("\n\n");
      if (!restored) return;

      if (composerContextRef.current.key === requestContext.key) {
        composerRevisionRef.current += 1;
        setInput((current) => [restored, current].filter((text) => text.trim().length > 0).join("\n\n"));
        requestAnimationFrame(() => {
          const textarea = textareaRef.current;
          if (!textarea) return;
          textarea.focus();
          textarea.setSelectionRange(textarea.value.length, textarea.value.length);
          setCaret(textarea.value.length);
          autosize();
        });
      } else {
        const draft = getComposerWorkspaceDraft(requestContext.cwd, requestContext.sessionId);
        setComposerWorkspaceDraft(
          requestContext.cwd,
          requestContext.sessionId,
          [restored, draft.input].filter((text) => text.trim().length > 0).join("\n\n"),
          draft.attachments,
        );
      }
    } catch (error) {
      showToast(t("Failed to stop generation: {error}", "停止生成失败：{error}", {
        error: error instanceof Error ? error.message : String(error),
      }), "error");
    } finally {
      setAborting(false);
    }
  }

  const isSlashCommand = input.trimStart().startsWith("/");
  const hasDraft = input.trim().length > 0 || attachments.length > 0;
  const streamingSubmitLabel = isSlashCommand
    ? t("Run command", "运行命令")
    : streamingSubmitMode === "steer"
      ? t("Steer current run", "引导当前运行")
      : t("Queue follow-up", "加入跟进队列");
  const inputPlaceholder = activeBackendReady
    ? t("Send a message...", "发送消息…")
    : backendStatus.starting || backendStatus.restarting
      ? t("Write while the agent starts...", "智能体启动中，可先输入…")
      : t("Write a draft...", "输入草稿…");

  return (
    <div className="composer-wrap">
      <ExtensionWidgets widgets={extensionWidgets} placement="aboveEditor" />
      {showTaskProgress && (
        <div
          className={`composer-task-progress ${activeTaskGoal?.status === "blocked" ? "blocked" : isStreaming ? "running" : ""}`}
          role="status"
          aria-live="polite"
        >
          <span className="composer-task-progress-dot" aria-hidden="true" />
          <span className="composer-task-progress-copy">
            <strong title={activeTaskGoal?.objective}>
              {activeTaskGoal?.objective ?? t("Task progress", "任务进度")}
            </strong>
            <span title={currentPlanStep?.step}>
              {activeTaskGoal?.status === "blocked"
                ? t("Needs input", "需要输入")
                : currentPlanStep?.step
                  ?? (isStreaming ? t("Working", "正在处理") : t("Ready for the next step", "等待下一步"))}
            </span>
          </span>
          {taskPlan && taskPlan.steps.length > 0 && (
            <>
              <span className="composer-task-progress-count">
                {completedPlanSteps}/{taskPlan.steps.length}
              </span>
              <progress
                className="composer-task-progress-bar"
                max={taskPlan.steps.length}
                value={completedPlanSteps}
                aria-label={t("{completed} of {total} completed", "已完成 {completed}/{total}", {
                  completed: completedPlanSteps,
                  total: taskPlan.steps.length,
                })}
              />
            </>
          )}
        </div>
      )}
      {approvalRequests.length > 0 && (
        <div className="composer-approval-stack">
          {approvalRequests.map((request) => (
            <InlineApproval key={request.id} request={request} />
          ))}
        </div>
      )}
      <form
        className={`composer${showWorkspacePicker ? " with-workspace-picker" : ""}${draggingFiles ? " drag-active" : ""}`}
        onSubmit={handleSubmit}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {draggingFiles && (
          <div
            className="composer-drop-overlay"
            role="status"
            aria-live="polite"
          >
            <span className="composer-drop-title">
              {t("Drop files to attach", "拖放文件以附加")}
            </span>
            <span className="composer-drop-description">
              {t(
                "Up to {count} files; images can be up to {size} MB each",
                "最多 {count} 个文件；图片每张不超过 {size} MB",
                { count: MAX_ATTACHMENT_COUNT, size: MAX_ATTACHMENT_MEGABYTES },
              )}
            </span>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="composer-attachments" role="group" aria-label={t("Attachments", "附件")}>
            {attachments.map((attachment) => (
              <div className={`composer-attachment ${attachment.type === "file" ? "file" : ""}`} key={attachment.id}>
                {attachment.type === "image" ? (
                  <img
                    src={`data:${attachment.mimeType};base64,${attachment.data}`}
                    alt={attachment.name}
                    title={attachment.name}
                  />
                ) : (
                  <div className="composer-attachment-file" title={attachment.path}>
                    <Icon name="file" size={18} />
                    <span>{attachment.name}</span>
                  </div>
                )}
                <button
                  className="composer-attachment-remove"
                  type="button"
                  aria-label={t("Remove {name}", "移除 {name}", { name: attachment.name })}
                  title={t("Remove attachment", "移除附件")}
                  disabled={submitting}
                  onClick={() => {
                    composerRevisionRef.current += 1;
                    setAttachments((current) => current.filter((item) => item.id !== attachment.id));
                  }}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
        {showWorkspacePicker && (
          <button
            className="composer-workspace-picker"
            type="button"
            onClick={() => void handleChooseWorkspace()}
            disabled={workspaceLoading}
            title={!isTaskContext && workspaceCwd ? workspaceCwd : t("Choose a project", "选择项目")}
          >
            <Icon name="folder" size={17} strokeWidth={1.5} />
            <span>
              {isTaskContext
                ? t("Choose project", "选择项目")
                : workspaceCwd.split(/[\\/]/).filter(Boolean).pop() ?? t("Choose project", "选择项目")}
            </span>
          </button>
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
            onChange={(e) => {
              composerRevisionRef.current += 1;
              setInput(e.target.value);
              setCaret(e.target.selectionStart);
              autosize();
            }}
            onKeyDown={handleKeyDown}
            onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onClick={(e) => setCaret(e.currentTarget.selectionStart)}
            onPaste={handlePaste}
            placeholder={inputPlaceholder}
            rows={1}
            role="combobox"
            aria-autocomplete="list"
            aria-controls={menuOpen ? suggestionsListboxId : undefined}
            aria-expanded={menuOpen}
            aria-activedescendant={menuOpen && suggestions[activeIndex] ? `${suggestionsListboxId}-${activeIndex}` : undefined}
            aria-label={t("Message input", "消息输入框")}
            aria-describedby="composer-attachment-hint"
            disabled={submitting}
          />
          <span className="composer-a11y-description" id="composer-attachment-hint">
            {t(
              "Paste images or select and drop files to attach them. Up to {count} files; images can be {size} megabytes each.",
              "可粘贴图片，或选择、拖放文件作为附件。最多 {count} 个文件；图片每张不超过 {size} MB。",
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
              aria-label={t("Attach files", "附加文件")}
              multiple
              tabIndex={-1}
              onChange={handleAttachmentSelection}
            />
            <button
              className="composer-attach-btn"
              type="button"
              aria-label={t("Attach files", "附加文件")}
              title={t("Attach files", "附加文件")}
              disabled={submitting || readingAttachments}
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon name="plus" size={18} />
            </button>
            <PermissionSelector />
          </div>
          <div className="composer-footer-end">
            {!workspaceLoading && <ContextMeter />}
            {!isStreaming && (
              <div className={`composer-model-slot ${workspaceLoading ? "loading" : ""}`} inert={workspaceLoading}>
                <ModelSelector />
              </div>
            )}
            <div className="composer-actions">
              {isStreaming && (
                <>
                  {hasDraft && !isSlashCommand && (
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
                  )}
                  <button
                    className="composer-abort-btn"
                    type="button"
                    disabled={aborting}
                    onClick={handleAbort}
                    aria-busy={aborting}
                    aria-label={aborting
                      ? t("Stopping generation", "正在停止生成")
                      : t("Stop generating", "停止生成")}
                  >
                    <span className="composer-abort-icon" aria-hidden="true" />
                    <span>{t("Stop", "停止")}</span>
                  </button>
                </>
              )}
              {(!isStreaming || hasDraft) && (
                <button
                  className={`composer-send-btn ${isStreaming ? "queue-mode" : ""}`}
                  type="submit"
                  disabled={
                    submitting ||
                    readingAttachments ||
                    !activeBackendReady ||
                    isPromptSubmissionBlocked(retrying, compacting) ||
                    !hasDraft ||
                    (attachments.some((attachment) => attachment.type === "image") && !modelSupportsImages)
                  }
                  aria-label={isStreaming ? streamingSubmitLabel : t("Send message", "发送消息")}
                  title={
                    !activeBackendReady
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
              )}
            </div>
          </div>
        </div>
      </form>
      <ExtensionWidgets widgets={extensionWidgets} placement="belowEditor" />
    </div>
  );
}
