import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type FormEvent } from "react";
import { useStore } from "../../store";
import * as api from "../../ipc/api";
import { PermissionSelector } from "../PermissionSelector";

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
  const [input, setInput] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [fileMatches, setFileMatches] = useState<string[]>([]);
  const isStreaming = useStore((s) => s.isStreaming);
  const commands = useStore((s) => s.commands);
  const queuedSteering = useStore((s) => s.queuedSteering);
  const queuedFollowUp = useStore((s) => s.queuedFollowUp);
  const composerDraft = useStore((s) => s.composerDraft);
  const setComposerDraft = useStore((s) => s.setComposerDraft);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRequestSeq = useRef(0);

  const token = getActiveToken(input, input.length);

  // Consume a draft pushed from elsewhere (e.g. empty-state action cards):
  // prefill the input, focus, size to fit, then clear the shared draft.
  useEffect(() => {
    if (composerDraft == null) return;
    setInput(composerDraft);
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

  async function submit(message: string) {
    // During a run, plain messages queue as follow-up; slash commands must go
    // through prompt (backend rejects extension commands via steer/follow_up).
    if (isStreaming && !message.startsWith("/")) {
      await api.followUp(message);
    } else {
      await api.sendPrompt(message);
    }
  }

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (menuOpen && suggestions[activeIndex]) {
      applySuggestion(suggestions[activeIndex]);
      return;
    }
    const message = input.trim();
    if (!message) return;
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    await submit(message);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
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
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  async function handleAbort() {
    await api.abort();
  }

  const queued = [...queuedSteering, ...queuedFollowUp];

  return (
    <div className="composer-wrap">
      <div className="composer-toolbar">
        <PermissionSelector />
      </div>
      {queued.length > 0 && (
        <div className="composer-queue" aria-label="Queued messages">
          {queued.map((msg, i) => (
            <div className="composer-queue-item" key={i} title={msg}>
              <span className="composer-queue-badge">queued</span>
              <span className="composer-queue-text">{msg}</span>
            </div>
          ))}
        </div>
      )}
      <form className="composer" onSubmit={handleSubmit}>
        <div className="composer-input-wrap">
          {menuOpen && suggestions.length > 0 && (
            <div className="composer-suggestions" role="listbox">
              {suggestions.map((s, i) => (
                <button
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
            placeholder={isStreaming ? "Queue a follow-up message..." : "Send a message... (/ for commands, @ for files)"}
            rows={1}
            aria-label="Message input"
          />
        </div>
        <div className="composer-actions">
          {isStreaming && (
            <button
              className="composer-abort-btn"
              type="button"
              onClick={handleAbort}
              aria-label="Stop generating"
            >
              Stop
            </button>
          )}
          <button
            className="composer-send-btn"
            type="submit"
            disabled={!input.trim()}
            aria-label={isStreaming ? "Queue message" : "Send message"}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M22 2 11 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="m22 2-7 20-4-9-9-4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
