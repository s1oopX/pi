import { useRef, useState, type KeyboardEvent, type FormEvent } from "react";
import { useStore } from "../../store";
import * as api from "../../ipc/api";

export function Composer() {
  const [input, setInput] = useState("");
  const isStreaming = useStore((s) => s.isStreaming);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function autosize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    const message = input.trim();
    if (!message || isStreaming) return;
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    await api.sendPrompt(message);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  async function handleAbort() {
    await api.abort();
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <div className="composer-input-wrap">
        <textarea
          ref={textareaRef}
          className="composer-input"
          value={input}
          onChange={(e) => { setInput(e.target.value); autosize(); }}
          onKeyDown={handleKeyDown}
          placeholder="Send a message..."
          rows={1}
          disabled={isStreaming}
          aria-label="Message input"
        />
      </div>
      <div className="composer-actions">
        {isStreaming ? (
          <button
            className="composer-abort-btn"
            type="button"
            onClick={handleAbort}
            aria-label="Stop generating"
          >
            Stop
          </button>
        ) : (
          <button
            className="composer-send-btn"
            type="submit"
            disabled={!input.trim()}
            aria-label="Send message"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M22 2 11 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="m22 2-7 20-4-9-9-4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
    </form>
  );
}
