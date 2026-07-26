import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import { translateText, useI18n, type ResolvedLanguage } from "../../i18n";
import { useElapsedSeconds } from "../../hooks/useElapsedSeconds";
import { useStore } from "../../store";
import { Icon } from "../Icon";
import { CodeBlock } from "./CodeBlock";
import { CodeStreamingContext } from "./codeStreamingContext";
import { DiffView } from "../DiffView";
import { buildFileChangeDisplayPlan, type FileChange } from "../MessageList/toolPairing";
import { formatAgentLiveStatus } from "./agentLiveStatus";
import { PathActions } from "./PathActions";
import {
  createProcessExpandState,
  reduceProcessExpandState,
  resolveFileChangeDefaultOpen,
} from "./processExpandState";
import {
  describeToolCall,
  formatDisplayPath,
  resolveToolPhase,
  toolPhaseLabel,
  type ToolPhase,
} from "./toolPresentation";
import { shouldAutoExpandToolBody, summarizeToolOutput } from "./toolOutputPresentation";
import { formatMessageMeta } from "./messageMeta";
import { beginEditUserMessage } from "./editUserMessage";
import { TurnSummary } from "./TurnSummary";
import * as ipcApi from "../../ipc/api";
import type { Message, ToolCall } from "../../ipc/types";
import type { ToolExecutionsByCallId } from "../../store";
import { IMAGE_ONLY_PROMPT } from "../Composer/attachments";

type ResultsByCallId = Map<string, Extract<Message, { role: "toolResult" }>>;

interface MessageBubbleProps {
  message: Message;
  streaming?: boolean;
  suppressError?: boolean;
  resultsByCallId?: ResultsByCallId;
  toolExecutionsByCallId: ToolExecutionsByCallId;
}

export function getMarkdownCodeLanguage(className: string | undefined, code: string): string | null {
  const match = /(?:^|\s)language-([^\s]+)/.exec(className ?? "");
  if (match) return match[1];
  return code.includes("\n") ? "" : null;
}

const markdownComponents: Components = {
  code(props) {
    const { children, className, ...rest } = props;
    const code = String(children);
    const language = getMarkdownCodeLanguage(className, code);
    if (language !== null) {
      return (
        <CodeBlock
          code={code.replace(/\n$/, "")}
          language={language}
        />
      );
    }
    return (
      <code className="inline-code" {...rest}>
        {children}
      </code>
    );
  },
  pre(props) {
    const { children } = props;
    return <>{children}</>;
  },
};

/** Flatten user/toolResult content blocks (string or block array) to text. */
function contentToText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content;
  return content
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text ?? "")
    .join("\n\n");
}

function isDiffContent(text: string): boolean {
  return text.startsWith("---") || text.startsWith("diff --git") || text.startsWith("@@");
}

function AssistantContent({
  message,
  streaming,
  suppressError,
  resultsByCallId,
  toolExecutionsByCallId,
}: {
  message: Extract<Message, { role: "assistant" }>;
  streaming?: boolean;
  suppressError?: boolean;
  resultsByCallId?: Map<string, Extract<Message, { role: "toolResult" }>>;
  toolExecutionsByCallId: ToolExecutionsByCallId;
}) {
  const { resolvedLanguage, t } = useI18n();
  const activeTool = useStore((state) => state.activeTool);
  const compactionActivity = useStore((state) => state.compactionActivity);
  const sessionCompacting = useStore((state) => Boolean(state.session?.isCompacting));
  const isCompacting = compactionActivity !== null || sessionCompacting;
  const elapsedSeconds = useElapsedSeconds(Boolean(streaming) || isCompacting);
  const stepCount = Object.keys(toolExecutionsByCallId).length;
  const liveStatus = formatAgentLiveStatus({
    isStreaming: Boolean(streaming),
    elapsedSeconds,
    activeTool,
    isCompacting,
    compactionReason: compactionActivity?.reason,
    stepCount,
    language: resolvedLanguage === "zh-CN" ? "zh-CN" : "en",
  });
  // Render blocks in their natural order (thinking usually precedes text and
  // tool calls) so the assistant's reasoning shows before its answer.
  const hasRenderableContent = message.content.some(
    (block) =>
      (block.type === "text" && block.text) ||
      (block.type === "thinking" && block.thinking) ||
      block.type === "toolCall",
  );
  const errorMessage = message.errorMessage;
  // While streaming, reasoning is only "live" until the first text/toolCall
  // block appears after it (that means the model moved on to the answer).
  const lastTextOrToolIndex = message.content.reduce(
    (acc, block, idx) => (block.type === "text" || block.type === "toolCall" ? idx : acc),
    -1,
  );

  const fileChangePlan = buildFileChangeDisplayPlan(
    message,
    resultsByCallId ?? new Map(),
    toolExecutionsByCallId,
    Boolean(streaming),
  );

  // Track whether any process row has already been emitted so the first answer
  // paragraph can get a visual "gear change" away from the process log.
  let processEmitted = false;

  return (
    <CodeStreamingContext.Provider value={Boolean(streaming)}>
    <div className="message-content">
      {message.content.map((block, i) => {
        const fileChangeGroup = fileChangePlan.groupsByStartIndex.get(i);
        if (fileChangeGroup) {
          processEmitted = true;
          return (
            <FileChangesCard
              key={`file-changes:${fileChangeGroup.changes[0].callId}`}
              changes={fileChangeGroup.changes}
            />
          );
        }
        if (block.type === "thinking") {
          const blockStreaming = streaming && i > lastTextOrToolIndex;
          if (!block.thinking) return null;
          processEmitted = true;
          return (
            <ThinkingPart key={i} thinking={block.thinking} redacted={block.redacted} streaming={blockStreaming} />
          );
        }
        if (block.type === "text") {
          if (!block.text) return null;
          const answerClass = processEmitted ? "message-answer after-process" : "message-answer";
          return (
            <div key={i} className={answerClass}>
              <Markdown components={markdownComponents}>{block.text}</Markdown>
            </div>
          );
        }
        if (block.type === "toolCall") {
          if (fileChangePlan.hiddenCallIds.has(block.id)) return null;
          const result = block.id ? resultsByCallId?.get(block.id) : undefined;
          const phase = resolveToolPhase(block.id, result, toolExecutionsByCallId, Boolean(streaming));
          processEmitted = true;
          return (
            <ToolCallPart
              key={block.id ?? i}
              call={block}
              result={result}
              phase={phase}
              liveOutput={block.id ? toolExecutionsByCallId[block.id]?.liveOutput : undefined}
            />
          );
        }
        return null;
      })}
      {liveStatus.visible && !errorMessage && (
        <div
          className={`agent-working agent-working-tail tone-${liveStatus.tone}`}
          role="status"
          aria-live="polite"
          aria-label={liveStatus.line}
        >
          <span className="agent-working-dot" aria-hidden="true" />
          <span className="agent-working-primary">{liveStatus.primary}</span>
          {liveStatus.steps && (
            <span className="agent-working-steps">{liveStatus.steps}</span>
          )}
          {liveStatus.elapsed && (
            <span className="agent-working-elapsed">{liveStatus.elapsed}</span>
          )}
        </div>
      )}
      {!streaming && !errorMessage && (
        <TurnSummary message={message} language={resolvedLanguage} />
      )}
      {errorMessage && !suppressError && (
        <div className="message-error" role="alert">
          <span className="message-error-icon" aria-hidden="true">&#9888;</span>
          <span className="message-error-text">{errorMessage}</span>
        </div>
      )}
      {!hasRenderableContent && !errorMessage && !streaming && (
        <p className="message-empty-note">{t("The model returned an empty response.", "模型返回了空响应。")}</p>
      )}
    </div>
    </CodeStreamingContext.Provider>
  );
}

function ThinkingPart({
  thinking,
  redacted,
  streaming,
}: {
  thinking: string;
  redacted?: boolean;
  streaming?: boolean;
}) {
  const { t } = useI18n();
  const [expandState, setExpandState] = useState(() => createProcessExpandState(Boolean(streaming)));
  const prevStreaming = useRef(Boolean(streaming));
  useEffect(() => {
    if (streaming === prevStreaming.current) return;
    prevStreaming.current = Boolean(streaming);
    setExpandState((state) => reduceProcessExpandState(
      state,
      { type: streaming ? "stream-start" : "stream-end" },
      "thinking",
    ));
  }, [streaming]);

  const label = redacted
    ? t("Thoughts hidden", "思考内容已隐藏")
    : streaming
      ? t("Thinking…", "正在思考…")
      : t("Thought for a moment", "已思考片刻");
  const expanded = expandState.open;

  return (
    <div className={`thinking-part ${streaming ? "streaming" : ""}`}>
      <button
        className="thinking-header"
        type="button"
        onClick={() => {
          setExpandState((state) => reduceProcessExpandState(state, { type: "user-toggle" }, "thinking"));
        }}
        aria-expanded={expanded}
      >
        <span className="thinking-icon" aria-hidden="true">&#10022;</span>
        <span className="thinking-label">{label}</span>
        <span className="thinking-chevron" aria-hidden="true">{expanded ? "\u25be" : "\u25b8"}</span>
      </button>
      {expanded && (
        <div className="thinking-body">
          <Markdown components={markdownComponents}>{thinking}</Markdown>
        </div>
      )}
    </div>
  );
}

function ToolCallPart({
  call,
  result,
  phase,
  liveOutput,
}: {
  call: ToolCall;
  result?: Extract<Message, { role: "toolResult" }>;
  phase: ToolPhase;
  liveOutput?: string;
}) {
  const { resolvedLanguage, t } = useI18n();
  const presentation = describeToolCall(call, phase, resolvedLanguage);
  const resultText = result ? contentToText(result.content) : "";
  const resultImages = result?.content.filter((block) => block.type === "image") ?? [];
  const hasInput = Boolean(presentation.inputText && presentation.inputText !== "{}");
  const hasOutput = Boolean(resultText || resultImages.length > 0);
  const hasBody = hasInput || hasOutput;
  const outputSummary = resultText ? summarizeToolOutput(resultText) : null;
  const displayOutput = outputSummary?.preview ?? "";
  // Full path stays in title when subject was shortened for the header row.
  const subjectTitle = typeof call.arguments.path === "string"
    ? call.arguments.path
    : typeof call.arguments.file_path === "string"
      ? call.arguments.file_path
      : presentation.subject;
  const showStatusLabel = phase === "error" || phase === "unknown";
  const [expandState, setExpandState] = useState(() =>
    createProcessExpandState(shouldAutoExpandToolBody(phase, hasBody)),
  );

  useEffect(() => {
    if (phase === "error") {
      setExpandState((state) => reduceProcessExpandState(state, { type: "phase-error" }, "tool"));
    }
  }, [phase]);
  const expanded = expandState.open;

  return (
    <div className={`tool-call-part status-${phase}`}>
      <button
        className="tool-call-header"
        type="button"
        onClick={() => {
          if (!hasBody) return;
          setExpandState((state) => reduceProcessExpandState(state, { type: "user-toggle" }, "tool"));
        }}
        aria-expanded={expanded}
        disabled={!hasBody}
      >
        <span className="tool-call-icon" aria-hidden="true">
          {phase === "running" ? (
            <span className="tool-call-running-dot" />
          ) : (
            <Icon name="activity" size={13} strokeWidth={1.4} />
          )}
        </span>
        <span className="tool-call-summary">
          <span className="tool-call-action">{presentation.action}</span>
          {presentation.subject && (
            <span className="tool-call-subject" title={subjectTitle}>{presentation.subject}</span>
          )}
          {presentation.meta && phase !== "done" && (
            <span className="tool-call-meta" title={presentation.meta}>{presentation.meta}</span>
          )}
        </span>
        {showStatusLabel && (
          <span className={`tool-call-status tool-call-status-${phase}`}>
            {toolPhaseLabel(phase, resolvedLanguage)}
          </span>
        )}
        {hasBody && (
          <span className="tool-call-chevron" aria-hidden="true">{expanded ? "\u25be" : "\u25b8"}</span>
        )}
      </button>
      {phase === "running" && liveOutput && (
        <pre className="tool-live-output">
          <code>{liveOutput.length > 2000 ? liveOutput.slice(-2000) : liveOutput}</code>
        </pre>
      )}
      {expanded && hasBody && (
        <div className="tool-call-body">
          {presentation.meta && (
            <div className="tool-call-section">
              <div className="tool-call-section-label">{t("Details", "详情")}</div>
              <div className="tool-call-meta-line">{presentation.meta}</div>
            </div>
          )}
          {hasInput && (
            <div className="tool-call-section">
              <div className="tool-call-section-label">{t("Input", "输入")}</div>
              <pre className="tool-call-args"><code>{presentation.inputText}</code></pre>
            </div>
          )}
          {hasOutput && (
            <div className="tool-call-section">
              <div className="tool-call-section-label">{t("Output", "输出")}</div>
              {displayOutput && (
                <pre className={`tool-call-result-output ${result?.isError ? "error" : ""}`}>
                  <code>{displayOutput}</code>
                </pre>
              )}
              {outputSummary?.truncated && (
                <div className="tool-call-output-note">
                  {t(
                    "Showing last lines of {count}-line output",
                    "显示 {count} 行输出的末尾",
                    { count: outputSummary.lineCount },
                  )}
                </div>
              )}
              {resultImages.length > 0 && (
                <div className="tool-call-result-images">
                  {resultImages.map((image, index) => (
                    <img
                      key={`${image.mimeType}:${index}`}
                      src={`data:${image.mimeType};base64,${image.data}`}
                      alt={t("{tool} result {index}", "{tool} 结果 {index}", {
                        tool: call.name,
                        index: index + 1,
                      })}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BashExecutionContent({ message }: { message: Extract<Message, { role: "bashExecution" }> }) {
  return (
    <div className="bash-execution">
      <div className="bash-execution-header">
        <span className="bash-icon" aria-hidden="true">$</span>
        <span>{message.command}</span>
      </div>
      <pre className="bash-execution-output"><code>{message.output}</code></pre>
    </div>
  );
}

function ToolResultContent({ message }: { message: Extract<Message, { role: "toolResult" }> }) {
  const text = contentToText(message.content);
  if (isDiffContent(text)) {
    return <DiffView patch={text} />;
  }
  return (
    <div className="message-content">
      <CodeBlock code={text} language="text" />
    </div>
  );
}

function PlainMarkdown({ text }: { text: string }) {
  return (
    <div className="message-content">
      <Markdown components={markdownComponents}>{text}</Markdown>
    </div>
  );
}

function UserContent({ message }: { message: Extract<Message, { role: "user" }> }) {
  const { t } = useI18n();
  const text = contentToText(message.content);
  const images = Array.isArray(message.content)
    ? message.content.filter((block) => block.type === "image")
    : [];
  const visibleText = images.length > 0 && text === IMAGE_ONLY_PROMPT ? "" : text;
  return (
    <div className={`message-content user-message-content ${visibleText ? "" : "images-only"}`}>
      {images.length > 0 && (
        <div className="user-message-images">
          {images.map((image, index) => (
            <img
              key={`${image.mimeType}:${index}`}
              src={`data:${image.mimeType};base64,${image.data}`}
              alt={t("Attached image {index}", "附件图片 {index}", { index: index + 1 })}
            />
          ))}
        </div>
      )}
      {visibleText && <Markdown components={markdownComponents}>{visibleText}</Markdown>}
    </div>
  );
}

function EditButton({ message, language }: { message: Message; language: ResolvedLanguage }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);

  async function handleEdit() {
    if (editing) return;
    setEditing(true);
    try {
      await beginEditUserMessage(message, language);
    } finally {
      setEditing(false);
    }
  }

  return (
    <button
      className="message-copy-btn message-edit-btn"
      type="button"
      disabled={editing}
      onClick={handleEdit}
      aria-label={t("Edit and resend", "编辑并重发")}
      title={t("Edit and resend", "编辑并重发")}
    >
      <Icon name="pencil" size={14} strokeWidth={1.7} />
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    ipcApi.writeClipboardText(text).catch(() => {
      navigator.clipboard?.writeText(text);
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      className="message-copy-btn"
      type="button"
      onClick={handleCopy}
      aria-label={t("Copy message", "复制消息")}
      title={copied ? t("Copied", "已复制") : t("Copy", "复制")}
    >
      {copied ? (
        <Icon name="check" size={14} strokeWidth={1.8} />
      ) : (
        <Icon name="copy" size={14} />
      )}
    </button>
  );
}

// Extracts copyable plain text from any message role.
function messageToCopyText(message: Message): string {
  switch (message.role) {
    case "assistant":
      return message.content
        .map((block) => {
          if (block.type === "text") return block.text;
          if (block.type === "thinking") return block.thinking;
          if (block.type === "toolCall") return `[tool: ${block.name}]`;
          return "";
        })
        .filter(Boolean)
        .join("\n\n");
    case "user":
      if (
        Array.isArray(message.content) &&
        message.content.some((block) => block.type === "image") &&
        contentToText(message.content) === IMAGE_ONLY_PROMPT
      ) {
        return "";
      }
      return contentToText(message.content);
    case "custom":
      return contentToText(message.content);
    case "bashExecution":
      return `$ ${message.command}\n${message.output}`;
    case "toolResult":
      return contentToText(message.content);
    case "branchSummary":
    case "compactionSummary":
      return message.summary;
    default:
      return "";
  }
}

function fileChangeOpLabel(tool: FileChange["tool"]): string {
  return tool === "write" ? "A" : "M";
}

function FileChangeRow({ change, defaultOpen = false }: { change: FileChange; defaultOpen?: boolean }) {
  const { resolvedLanguage, t } = useI18n();
  const hasPreview = Boolean(change.previewPatch);
  const errorText = change.phase === "error" ? change.resultText : undefined;
  const canExpand = hasPreview || Boolean(errorText);
  const [expandState, setExpandState] = useState(() =>
    createProcessExpandState(defaultOpen || change.phase === "error"),
  );

  useEffect(() => {
    if (change.phase === "error") {
      setExpandState((state) => reduceProcessExpandState(state, { type: "phase-error" }, "file-row"));
    }
  }, [change.phase]);
  const open = expandState.open;

  return (
    <li className={`file-changes-item status-${change.phase}${open ? " is-open" : ""}`}>
      <div className="file-changes-item-row">
        <button
          className="file-changes-item-main"
          type="button"
          disabled={!canExpand}
          aria-expanded={canExpand ? open : undefined}
          onClick={() => {
            if (!canExpand) return;
            setExpandState((state) => reduceProcessExpandState(state, { type: "user-toggle" }, "file-row"));
          }}
        >
          <span className="file-changes-op" title={change.tool}>{fileChangeOpLabel(change.tool)}</span>
          <span className="file-changes-path" title={change.path}>{formatDisplayPath(change.path)}</span>
          {(change.phase === "error" || change.phase === "running") && (
            <span className={`file-changes-item-status status-${change.phase}`}>
              {toolPhaseLabel(change.phase, resolvedLanguage)}
            </span>
          )}
          {canExpand && (
            <span className="file-changes-item-chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
          )}
        </button>
        <PathActions path={change.path} />
      </div>
      {open && errorText && (
        <pre className="file-changes-result error">
          <code>{errorText}</code>
        </pre>
      )}
      {open && hasPreview && (
        <div className="file-changes-diff" role="group" aria-label={t("Change preview", "更改预览")}>
          <DiffView patch={change.previewPatch!} />
        </div>
      )}
    </li>
  );
}

function FileChangesCard({ changes }: { changes: FileChange[] }) {
  const { t } = useI18n();
  const failed = changes.filter((change) => change.phase === "error").length;
  const running = changes.filter((change) => change.phase === "running").length;
  const queued = changes.filter((change) => change.phase === "queued").length;
  const done = changes.filter((change) => change.phase === "done").length;
  const fileCount = new Set(changes.map((change) => change.path)).size;
  const [expanded, setExpanded] = useState(failed > 0 || fileCount === 1);
  const userToggled = useRef(false);

  useEffect(() => {
    if (failed > 0 && !userToggled.current) setExpanded(true);
  }, [failed]);

  const countValues = { count: fileCount };
  let title = t(
    fileCount === 1 ? "Changed {count} file" : "Changed {count} files",
    "已更改 {count} 个文件",
    countValues,
  );
  if (running > 0) {
    title = t(
      fileCount === 1 ? "Editing {count} file…" : "Editing {count} files…",
      "正在编辑 {count} 个文件…",
      countValues,
    );
  } else if (queued > 0) {
    title = t(
      fileCount === 1 ? "Waiting to edit {count} file" : "Waiting to edit {count} files",
      "等待编辑 {count} 个文件",
      countValues,
    );
  } else if (failed === changes.length) {
    title = t(
      fileCount === 1 ? "Failed to change {count} file" : "Failed to change {count} files",
      "更改 {count} 个文件失败",
      countValues,
    );
  } else if (done !== changes.length && failed === 0) {
    title = t(
      fileCount === 1 ? "{count} file change" : "{count} file changes",
      "{count} 个文件更改",
      countValues,
    );
  }

  return (
    <div className={`file-changes-card ${running > 0 ? "status-running" : failed > 0 ? "status-error" : ""}`}>
      <button
        className="file-changes-header"
        type="button"
        onClick={() => {
          userToggled.current = true;
          setExpanded((value) => !value);
        }}
        aria-expanded={expanded}
      >
        <span className="file-changes-icon" aria-hidden="true">
          {running > 0 ? (
            <span className="tool-call-running-dot" />
          ) : (
            <Icon name="file" size={15} />
          )}
        </span>
        <span className="file-changes-title">{title}</span>
        {failed > 0 && (
          <span className="file-changes-badge error">
            {t("{count} failed", "{count} 个失败", { count: failed })}
          </span>
        )}
        <span className="file-changes-chevron" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <ul className="file-changes-list">
          {changes.map((c) => (
            <FileChangeRow
              key={c.callId}
              change={c}
              defaultOpen={resolveFileChangeDefaultOpen({ fileCount, phase: c.phase })}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function getRoleLabel(role: Message["role"], language: ResolvedLanguage): string {
  switch (role) {
    case "user": return translateText(language, "You", "你");
    case "assistant": return "Pi";
    case "toolResult": return translateText(language, "Tool Result", "工具结果");
    case "bashExecution": return translateText(language, "Shell", "终端");
    case "custom": return translateText(language, "Note", "备注");
    case "branchSummary": return translateText(language, "Branch Summary", "分支摘要");
    case "compactionSummary": return translateText(language, "Summary", "摘要");
    default: return role;
  }
}

function MessageAvatar({ role }: { role: Message["role"] }) {
  if (role === "user") {
    return (
      <div className="message-avatar message-avatar-user" aria-hidden="true">
        <Icon name="user" size={16} strokeWidth={1.7} />
      </div>
    );
  }
  return (
    <div className="message-avatar message-avatar-assistant" aria-hidden="true">
      <span className="message-avatar-mark">π</span>
    </div>
  );
}

export function MessageBubble({
  message,
  streaming,
  suppressError,
  resultsByCallId,
  toolExecutionsByCallId,
}: MessageBubbleProps) {
  const { resolvedLanguage } = useI18n();
  const copyText = messageToCopyText(message);
  // Primary conversational roles get the avatar + turn layout; auxiliary roles
  // (tool results, shell, summaries) render as compact standalone blocks.
  const isConversational = message.role === "user" || message.role === "assistant";

  if (!isConversational) {
    return (
      <div className={`message-bubble message-${message.role}`}>
        <div className="message-role">
          <span>{getRoleLabel(message.role, resolvedLanguage)}</span>
          {copyText && <CopyButton text={copyText} />}
        </div>
        <MessageBody
          message={message}
          streaming={streaming}
          suppressError={suppressError}
          resultsByCallId={resultsByCallId}
          toolExecutionsByCallId={toolExecutionsByCallId}
        />
      </div>
    );
  }

  const meta = message.role === "assistant" && !streaming
    ? formatMessageMeta(message, resolvedLanguage)
    : null;
  const canEdit = message.role === "user" && !streaming;

  return (
    <div className={`message-turn message-turn-${message.role}`}>
      <MessageAvatar role={message.role} />
      <div className="message-turn-body">
        <div className="message-turn-head">
          <span className="message-turn-author">{getRoleLabel(message.role, resolvedLanguage)}</span>
          {meta?.line && (
            <span className="message-turn-meta" title={meta.line}>{meta.line}</span>
          )}
          {canEdit && <EditButton message={message} language={resolvedLanguage} />}
          {copyText && <CopyButton text={copyText} />}
        </div>
        <MessageBody
        message={message}
        streaming={streaming}
        suppressError={suppressError}
        resultsByCallId={resultsByCallId}
          toolExecutionsByCallId={toolExecutionsByCallId}
        />
      </div>
    </div>
  );
}

function MessageBody({
  message,
  streaming,
  suppressError,
  resultsByCallId,
  toolExecutionsByCallId,
}: {
  message: Message;
  streaming?: boolean;
  suppressError?: boolean;
  resultsByCallId?: ResultsByCallId;
  toolExecutionsByCallId: ToolExecutionsByCallId;
}) {
  switch (message.role) {
    case "assistant":
      return (
        <AssistantContent
          message={message}
          streaming={streaming}
          suppressError={suppressError}
          resultsByCallId={resultsByCallId}
          toolExecutionsByCallId={toolExecutionsByCallId}
        />
      );
    case "bashExecution":
      return <BashExecutionContent message={message} />;
    case "toolResult":
      return <ToolResultContent message={message} />;
    case "user":
      return <UserContent message={message} />;
    case "custom":
      return <PlainMarkdown text={contentToText(message.content)} />;
    case "branchSummary":
    case "compactionSummary":
      return <PlainMarkdown text={message.summary} />;
    default:
      return null;
  }
}
