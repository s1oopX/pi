import { useEffect, useRef, useState } from "react";
import { useStore } from "../../store";
import * as api from "../../ipc/api";
import type { ThinkingLevel } from "../../ipc/types";

const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: "关闭",
  minimal: "最低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
};

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

// Which submenu (if any) is expanded in the popover.
type Submenu = null | "model" | "thinking";

// Codex-style model picker: a compact pill in the composer footer that opens a
// tiered menu (model / reasoning level), each row expanding into a submenu.
export function ModelSelector() {
  const session = useStore((s) => s.session);
  const models = useStore((s) => s.models);
  const isStreaming = useStore((s) => s.isStreaming);

  const currentModel = session?.model;
  const thinkingLevel = (session?.thinkingLevel ?? "medium") as ThinkingLevel;
  const modelName =
    models.find((m) => m.provider === currentModel?.provider && m.id === currentModel?.id)?.name ??
    currentModel?.id ??
    "无模型";
  const modelSupportsThinking = currentModel?.reasoning ?? false;

  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<Submenu>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSubmenu(null);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function closeMenu() {
    setOpen(false);
    setSubmenu(null);
  }

  async function handleSelectModel(provider: string, modelId: string) {
    closeMenu();
    await api.setModel(provider, modelId);
    useStore.getState().refreshSession();
  }

  async function handleSelectThinking(level: ThinkingLevel) {
    closeMenu();
    await api.setThinkingLevel(level);
    useStore.getState().refreshSession();
  }

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        type="button"
        className="model-picker-trigger"
        onClick={() => setOpen((v) => !v)}
        disabled={isStreaming}
        aria-haspopup="menu"
        aria-expanded={open}
        title="模型与推理强度"
      >
        <span className="model-picker-bolt" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="13" height="13">
            <path
              d="M13 2 4 14h7l-1 8 9-12h-7z"
              fill="currentColor"
              stroke="none"
            />
          </svg>
        </span>
        <span className="model-picker-name">{modelName}</span>
        {modelSupportsThinking && thinkingLevel !== "off" && (
          <span className="model-picker-thinking">{THINKING_LABELS[thinkingLevel]}</span>
        )}
        <span className="model-picker-chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="12" height="12">
            <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="model-picker-popover" role="menu">
          {submenu === null && (
            <>
              <button
                type="button"
                className="model-picker-row"
                role="menuitem"
                onClick={() => setSubmenu("model")}
              >
                <span className="model-picker-row-label">模型</span>
                <span className="model-picker-row-value">{modelName}</span>
                <span className="model-picker-row-arrow" aria-hidden="true">&#8250;</span>
              </button>
              {modelSupportsThinking && (
                <button
                  type="button"
                  className="model-picker-row"
                  role="menuitem"
                  onClick={() => setSubmenu("thinking")}
                >
                  <span className="model-picker-row-label">推理强度</span>
                  <span className="model-picker-row-value">{THINKING_LABELS[thinkingLevel]}</span>
                  <span className="model-picker-row-arrow" aria-hidden="true">&#8250;</span>
                </button>
              )}
            </>
          )}

          {submenu === "model" && (
            <>
              <button
                type="button"
                className="model-picker-back"
                onClick={() => setSubmenu(null)}
              >
                <span aria-hidden="true">&#8249;</span>
                <span>模型</span>
              </button>
              <div className="model-picker-sublist">
                {models.length === 0 && <div className="model-picker-empty">无可用模型</div>}
                {models.map((m) => {
                  const active = m.provider === currentModel?.provider && m.id === currentModel?.id;
                  return (
                    <button
                      key={`${m.provider}:${m.id}`}
                      type="button"
                      className={`model-picker-suboption ${active ? "active" : ""}`}
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => handleSelectModel(m.provider, m.id)}
                    >
                      <span className="model-picker-suboption-name">{m.name ?? m.id}</span>
                      {active && (
                        <span className="model-picker-check" aria-hidden="true">
                          <svg viewBox="0 0 24 24" width="14" height="14">
                            <path
                              d="M20 6 9 17l-5-5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {submenu === "thinking" && (
            <>
              <button
                type="button"
                className="model-picker-back"
                onClick={() => setSubmenu(null)}
              >
                <span aria-hidden="true">&#8249;</span>
                <span>推理强度</span>
              </button>
              <div className="model-picker-sublist">
                {THINKING_LEVELS.map((level) => {
                  const active = level === thinkingLevel;
                  return (
                    <button
                      key={level}
                      type="button"
                      className={`model-picker-suboption ${active ? "active" : ""}`}
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => handleSelectThinking(level)}
                    >
                      <span className="model-picker-suboption-name">{THINKING_LABELS[level]}</span>
                      {active && (
                        <span className="model-picker-check" aria-hidden="true">
                          <svg viewBox="0 0 24 24" width="14" height="14">
                            <path
                              d="M20 6 9 17l-5-5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
