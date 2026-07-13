import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import { CodeBlock } from "./CodeBlock";
import { DiffView } from "../DiffView";
import type { Message } from "../../ipc/types";

interface MessageBubbleProps {
  message: Message;
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

function AssistantContent({ message }: { message: Extract<Message, { role: "assistant" }> }) {
  const textParts = message.content.filter((block) => block.type === "text");
  const toolCalls = message.content.filter((block) => block.type === "toolCall");

  const text = textParts.map((block) => (block.type === "text" ? block.text : "")).join("\n\n");

  return (
    <div className="message-content">
      {text && <Markdown components={markdownComponents}>{text}</Markdown>}
      {toolCalls.map((block, i) =>
        block.type === "toolCall" ? (
          <div className="tool-call-part" key={block.id ?? i}>
            <div className="tool-call-header">
              <span className="tool-call-icon" aria-hidden="true">&#9881;</span>
              <span className="tool-call-name">{block.name}</span>
            </div>
          </div>
        ) : null,
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

export function MessageBubble({ message }: MessageBubbleProps) {
  return (
    <div className={`message-bubble message-${message.role}`}>
      <div className="message-role">{getRoleLabel(message.role)}</div>
      <MessageBody message={message} />
    </div>
  );
}

function MessageBody({ message }: { message: Message }) {
  switch (message.role) {
    case "assistant":
      return <AssistantContent message={message} />;
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
