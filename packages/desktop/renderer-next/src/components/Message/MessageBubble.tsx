import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import { CodeBlock } from "./CodeBlock";
import { DiffView } from "../DiffView";
import { extractFileChanges, type FileChange } from "../MessageList/toolPairing";
import * as ipcApi from "../../ipc/api";
import type { Message } from "../../ipc/types";

type ResultsByCallId = Map<string, Extract<Message, { role: "toolResult" }>>;

interface MessageBubbleProps {
  message: Message;
  streaming?: boolean;
  resultsByCallId?: ResultsByCallId;
}

const markdownComponents: Components = {
  code(props) {
    const { children, className, ...rest } = props;
    const match = /language-(\w+)/.exec(className || "");
    const isBlock = Boolean(match);
    if (isBlock) {
      return (
        <CodeBlock
          code={String(children).replace(/\n$/, "")}
          language={match![1]}
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
  resultsByCallId,
}: {
  message: Extract<Message, { role: "assistant" }>;
  streaming?: boolean;
  resultsByCallId?: Map<string, Extract<Message, { role: "toolResult" }>>;
}) {
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

  const fileChanges = extractFileChanges(message, resultsByCallId ?? new Map());

  return (
    <div className="message-content">
      {message.content.map((block, i) => {
        if (block.type === "thinking") {
          const blockStreaming = streaming && i > lastTextOrToolIndex;
          return block.thinking ? (
            <ThinkingPart key={i} thinking={block.thinking} redacted={block.redacted} streaming={blockStreaming} />
          ) : null;
        }
        if (block.type === "text") {
          return block.text ? <Markdown key={i} components={markdownComponents}>{block.text}</Markdown> : null;
        }
        if (block.type === "toolCall") {
          const result = block.id ? resultsByCallId?.get(block.id) : undefined;
          return (
            <ToolCallPart
              key={block.id ?? i}
              name={block.name}
              args={block.arguments}
              result={result}
              pending={streaming}
            />
          );
        }
        return null;
      })}
      {fileChanges.length > 0 && <FileChangesCard changes={fileChanges} />}
      {errorMessage && (
        <div className="message-error" role="alert">
          <span className="message-error-icon" aria-hidden="true">&#9888;</span>
          <span className="message-error-text">{errorMessage}</span>
        </div>
      )}
      {!hasRenderableContent && !errorMessage && (
        <p className="message-empty-note">The model returned an empty response.</p>
      )}
    </div>
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
  const [expanded, setExpanded] = useState(Boolean(streaming));
  // Auto-expand while the reasoning is streaming in, then auto-collapse once it
  // finishes, unless the user has manually toggled it in the meantime.
  const userToggled = useRef(false);
  const prevStreaming = useRef(Boolean(streaming));
  useEffect(() => {
    if (streaming === prevStreaming.current) return;
    prevStreaming.current = Boolean(streaming);
    if (!userToggled.current) {
      setExpanded(Boolean(streaming));
    }
  }, [streaming]);

  return (
    <div className={`thinking-part ${streaming ? "streaming" : ""}`}>
      <button
        className="thinking-header"
        type="button"
        onClick={() => {
          userToggled.current = true;
          setExpanded((v) => !v);
        }}
        aria-expanded={expanded}
      >
        <span className="thinking-icon" aria-hidden="true">&#10022;</span>
        <span className="thinking-label">
          {redacted ? "Reasoning (redacted)" : streaming ? "Reasoning..." : "Reasoning"}
        </span>
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
  name,
  args,
  result,
  pending,
}: {
  name: string;
  args: Record<string, unknown>;
  result?: Extract<Message, { role: "toolResult" }>;
  pending?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const argKeys = args && typeof args === "object" ? Object.keys(args) : [];
  const hasArgs = argKeys.length > 0;
  const argsJson = hasArgs ? JSON.stringify(args, null, 2) : "";
  const resultText = result ? contentToText(result.content) : "";
  const hasBody = hasArgs || Boolean(resultText);
  // Status: error if the result flagged it, done if a result arrived, else the
  // call is still running (no result yet during streaming).
  const status: "error" | "done" | "running" = result?.isError
    ? "error"
    : result
      ? "done"
      : pending
        ? "running"
        : "done";

  return (
    <div className={`tool-call-part status-${status}`}>
      <button
        className="tool-call-header"
        type="button"
        onClick={() => hasBody && setExpanded((v) => !v)}
        aria-expanded={expanded}
        disabled={!hasBody}
      >
        <span className="tool-call-icon" aria-hidden="true">&#9881;</span>
        <span className="tool-call-name">{name}</span>
        <span className={`tool-call-status tool-call-status-${status}`}>
          {status === "error" ? "failed" : status === "running" ? "running" : "done"}
        </span>
        {hasBody && (
          <span className="tool-call-chevron" aria-hidden="true">{expanded ? "\u25be" : "\u25b8"}</span>
        )}
      </button>
      {expanded && hasBody && (
        <div className="tool-call-body">
          {hasArgs && <pre className="tool-call-args"><code>{argsJson}</code></pre>}
          {resultText && (
            <pre className={`tool-call-result-output ${result?.isError ? "error" : ""}`}>
              <code>{resultText}</code>
            </pre>
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

function CopyButton({ text }: { text: string }) {
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
      aria-label="Copy message"
      title={copied ? "Copied" : "Copy"}
    >
      {copied ? (
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
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

function FileChangesCard({ changes }: { changes: FileChange[] }) {
  const [expanded, setExpanded] = useState(false);
  const failed = changes.filter((c) => c.isError).length;
  const ok = changes.length - failed;

  return (
    <div className="file-changes-card">
      <button
        className="file-changes-header"
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="file-changes-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="15" height="15">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M14 2v6h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="file-changes-title">
          {changes.length} file{changes.length !== 1 ? "s" : ""} changed
        </span>
        {failed > 0 && <span className="file-changes-badge error">{failed} failed</span>}
        {ok > 0 && <span className="file-changes-badge ok">{ok} ok</span>}
        <span className="file-changes-chevron" aria-hidden="true">{expanded ? "\u25be" : "\u25b8"}</span>
      </button>
      {expanded && (
        <ul className="file-changes-list">
          {changes.map((c, i) => (
            <li key={`${c.path}:${i}`} className={`file-changes-item ${c.isError ? "error" : ""}`}>
              <span className="file-changes-op">{c.tool}</span>
              <span className="file-changes-path" title={c.path}>{c.path}</span>
              {c.isError && <span className="file-changes-item-status">failed</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function getRoleLabel(role: Message["role"]): string {
  switch (role) {
    case "user": return "You";
    case "assistant": return "Assistant";
    case "toolResult": return "Tool Result";
    case "bashExecution": return "Shell";
    case "custom": return "Note";
    case "branchSummary": return "Branch Summary";
    case "compactionSummary": return "Summary";
    default: return role;
  }
}

export function MessageBubble({ message, streaming, resultsByCallId }: MessageBubbleProps) {
  const copyText = messageToCopyText(message);
  return (
    <div className={`message-bubble message-${message.role}`}>
      <div className="message-role">
        <span>{getRoleLabel(message.role)}</span>
        {copyText && <CopyButton text={copyText} />}
      </div>
      <MessageBody message={message} streaming={streaming} resultsByCallId={resultsByCallId} />
    </div>
  );
}

function MessageBody({
  message,
  streaming,
  resultsByCallId,
}: {
  message: Message;
  streaming?: boolean;
  resultsByCallId?: ResultsByCallId;
}) {
  switch (message.role) {
    case "assistant":
      return <AssistantContent message={message} streaming={streaming} resultsByCallId={resultsByCallId} />;
    case "bashExecution":
      return <BashExecutionContent message={message} />;
    case "toolResult":
      return <ToolResultContent message={message} />;
    case "user":
      return <PlainMarkdown text={contentToText(message.content)} />;
    case "custom":
      return <PlainMarkdown text={contentToText(message.content)} />;
    case "branchSummary":
    case "compactionSummary":
      return <PlainMarkdown text={message.summary} />;
    default:
      return null;
  }
}
