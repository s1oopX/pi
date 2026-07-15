import { useState, useRef, useEffect } from "react";
import { useStore } from "../../store";
import * as api from "../../ipc/api";
import type { ThinkingLevel } from "../../ipc/types";

const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Max",
};

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

export function TopBar() {
  const session = useStore((s) => s.session);
  const models = useStore((s) => s.models);
  const isStreaming = useStore((s) => s.isStreaming);
  const openSettings = useStore((s) => s.openSettings);

  const currentModel = session?.model;
  const thinkingLevel = (session?.thinkingLevel ?? "medium") as ThinkingLevel;
  const modelName = models.find(
    (m) => m.provider === currentModel?.provider && m.id === currentModel?.id
  )?.name ?? currentModel?.id ?? "No model";
  const modelSupportsThinking = currentModel?.reasoning ?? false;

  const [modelOpen, setModelOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const thinkingRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!modelOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setModelOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [modelOpen]);

  useEffect(() => {
    if (!thinkingOpen) return;
    function handleClick(e: MouseEvent) {
      if (thinkingRef.current && !thinkingRef.current.contains(e.target as Node)) {
        setThinkingOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [thinkingOpen]);

  function handleSelectModel(provider: string, modelId: string) {
    setModelOpen(false);
    api.setModel(provider, modelId);
  }

  function handleSelectThinking(level: ThinkingLevel) {
    setThinkingOpen(false);
    api.setThinkingLevel(level);
  }

  return (
    <div className="top-bar">
      <div className="top-bar-left">
        <div className="model-selector" ref={dropdownRef}>
          <button
            className="model-selector-btn"
            type="button"
            onClick={() => setModelOpen((v) => !v)}
            disabled={isStreaming}
            aria-haspopup="listbox"
            aria-expanded={modelOpen}
          >
            <span className="model-selector-name">{modelName}</span>
            {thinkingLevel !== "off" && (
              <span className="thinking-badge" title={`Thinking: ${THINKING_LABELS[thinkingLevel]}`}>
                {THINKING_LABELS[thinkingLevel]}
              </span>
            )}
            <svg className="chevron-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>

          {modelOpen && (
            <div className="model-dropdown" role="listbox">
              {models.length === 0 && (
                <div className="model-dropdown-empty">No models available</div>
              )}
              {models.map((m) => (
                <button
                  key={`${m.provider}:${m.id}`}
                  className={`model-dropdown-item ${
                    m.provider === currentModel?.provider && m.id === currentModel?.id ? "active" : ""
                  }`}
                  type="button"
                  role="option"
                  aria-selected={m.provider === currentModel?.provider && m.id === currentModel?.id}
                  onClick={() => handleSelectModel(m.provider, m.id)}
                >
                  <span className="model-item-name">{m.name ?? m.id}</span>
                  <span className="model-item-provider">{m.provider}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {modelSupportsThinking && (
          <div className="thinking-selector" ref={thinkingRef}>
            <button
              className="thinking-selector-btn"
              type="button"
              onClick={() => setThinkingOpen((v) => !v)}
              disabled={isStreaming}
              aria-haspopup="listbox"
              aria-expanded={thinkingOpen}
              title="Thinking level"
            >
              <span className="thinking-selector-icon" aria-hidden="true">✦</span>
              <span className="thinking-selector-label">{THINKING_LABELS[thinkingLevel]}</span>
            </button>

            {thinkingOpen && (
              <div className="thinking-dropdown" role="listbox">
                {THINKING_LEVELS.map((level) => (
                  <button
                    key={level}
                    className={`thinking-dropdown-item ${level === thinkingLevel ? "active" : ""}`}
                    type="button"
                    role="option"
                    aria-selected={level === thinkingLevel}
                    onClick={() => handleSelectThinking(level)}
                  >
                    {THINKING_LABELS[level]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="top-bar-right">
        <button
          className="icon-button"
          type="button"
          aria-label="Settings"
          onClick={() => openSettings("models-providers")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"
              fill="none" stroke="currentColor" strokeWidth="1.5"
            />
            <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
