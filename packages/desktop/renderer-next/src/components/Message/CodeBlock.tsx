import { useContext, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { highlightCode } from "../../lib/markdown";
import * as ipcApi from "../../ipc/api";
import { showToast } from "../Toast";
import { CodeStreamingContext } from "./codeStreamingContext";

interface CodeBlockProps {
  code: string;
  language: string;
}

function inferFilePath(language: string, code: string): string | null {
  if (!language) return null;
  const firstLine = code.split("\n", 1)[0];
  const commentMatch = /^(?:\/\/|#|--|;)\s*(.+\.\w{1,10})$/.exec(firstLine.trim());
  if (commentMatch) return commentMatch[1].trim();
  return null;
}

function countLines(code: string): number {
  if (!code) return 0;
  return code.split("\n").length;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const { t } = useI18n();
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [applying, setApplying] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const streaming = useContext(CodeStreamingContext);
  const filePath = inferFilePath(language, code);
  const lineCount = countLines(code);

  useEffect(() => {
    // While the surrounding message is still streaming, the code text grows on
    // every token. Re-running shiki per token is wasteful and flickers, so we
    // hold the plain-text fallback and only highlight once the stream settles
    // (Codex-style "light up on completion"). Any stale html from a previous
    // finalized render is cleared so the fallback shows the live text.
    if (streaming) {
      setHtml(null);
      return;
    }
    let cancelled = false;
    highlightCode(code, language).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => { cancelled = true; };
  }, [code, language, streaming]);

  function handleCopy() {
    ipcApi.writeClipboardText(code).catch(() => {
      navigator.clipboard?.writeText(code);
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleApply() {
    if (!filePath || applying) return;
    setApplying(true);
    try {
      const command = `cat > "${filePath}" << 'PIEOF'\n${code}\nPIEOF`;
      await ipcApi.bash(command, true);
      showToast(t("Applied to {path}", "已应用到 {path}", { path: filePath }), "success");
    } catch (error) {
      showToast(t("Failed to apply: {error}", "应用失败：{error}", {
        error: error instanceof Error ? error.message : String(error),
      }), "error");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-lang">
          {filePath ?? (language || "text")}
          {lineCount > 1 && <span className="code-block-lines">{lineCount} lines</span>}
        </span>
        <span className="code-block-actions">
          {filePath && (
            <button
              className="code-block-action"
              type="button"
              onClick={handleApply}
              disabled={applying}
              aria-label={t("Apply to file", "应用到文件")}
            >
              {applying ? t("Applying…", "正在应用…") : t("Apply", "应用")}
            </button>
          )}
          <button
            className="code-block-action"
            type="button"
            onClick={handleCopy}
            aria-label={t("Copy code", "复制代码")}
          >
            {copied ? t("Copied", "已复制") : t("Copy", "复制")}
          </button>
        </span>
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
