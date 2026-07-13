import { useEffect, useRef, useState } from "react";
import { highlightCode } from "../../lib/markdown";
import * as ipcApi from "../../ipc/api";

interface CodeBlockProps {
  code: string;
  language: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    highlightCode(code, language).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => { cancelled = true; };
  }, [code, language]);

  function handleCopy() {
    ipcApi.writeClipboardText(code).catch(() => {
      navigator.clipboard?.writeText(code);
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-lang">{language || "text"}</span>
        <button
          className="code-block-copy"
          type="button"
          onClick={handleCopy}
          aria-label="Copy code"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {html ? (
        <div
          ref={containerRef}
          className="code-block-body"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="code-block-body code-block-fallback">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
