import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useI18n } from "../../i18n";
import { useStore } from "../../store";
import * as api from "../../ipc/api";
import type { Model, ThinkingLevel } from "../../ipc/types";
import { showToast } from "../Toast";
import { Icon } from "../Icon";

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const THINKING_LEVEL_SUFFIX_PATTERN = /^(.*?)(?:[-_: ])(off|minimal|low|medium|high|xhigh|max)$/i;

// Which submenu (if any) is expanded in the popover.
type Submenu = null | "model" | "thinking";

interface ModelOption {
  key: string;
  label: string;
  provider: string;
  models: Model[];
  byLevel: Partial<Record<ThinkingLevel, Model>>;
  fallback: Model;
}

function modelsMatch(a: Model, b: Model): boolean {
  return a.provider === b.provider && a.id === b.id;
}

function parseThinkingLevelSuffix(value: string): { base: string; level: ThinkingLevel | null } {
  const match = THINKING_LEVEL_SUFFIX_PATTERN.exec(value.trim());
  if (!match) return { base: value, level: null };
  const base = match[1].trim();
  if (!base) return { base: value, level: null };
  return { base, level: match[2].toLowerCase() as ThinkingLevel };
}

function getModelThinkingLevel(model: Model): ThinkingLevel | null {
  return parseThinkingLevelSuffix(model.id).level;
}

function getBaseModelLabel(model: Model): string {
  const nameParts = parseThinkingLevelSuffix(model.name ?? model.id);
  if (nameParts.level) return nameParts.base;
  const idParts = parseThinkingLevelSuffix(model.id);
  if (idParts.level) return idParts.base;
  return model.name ?? model.id;
}

function getGroupedOptionKey(model: Model): string | null {
  const idParts = parseThinkingLevelSuffix(model.id);
  if (!idParts.level) return null;
  return `${model.provider}:${idParts.base.toLocaleLowerCase()}`;
}

function getThinkingVariantCount(option: ModelOption): number {
  return THINKING_LEVELS.filter((level) => option.byLevel[level]).length;
}

function createSingleModelOption(model: Model): ModelOption {
  return {
    key: `${model.provider}:${model.id}`,
    label: model.name ?? model.id,
    provider: model.provider,
    models: [model],
    byLevel: {},
    fallback: model,
  };
}

function createGroupedModelOption(key: string, groupedModels: Model[]): ModelOption {
  const byLevel: Partial<Record<ThinkingLevel, Model>> = {};
  for (const model of groupedModels) {
    const level = getModelThinkingLevel(model);
    if (level && !byLevel[level]) byLevel[level] = model;
  }
  const fallback =
    byLevel.medium ??
    byLevel.high ??
    byLevel.low ??
    byLevel.xhigh ??
    byLevel.minimal ??
    byLevel.off ??
    groupedModels[0];
  return {
    key,
    label: getBaseModelLabel(fallback),
    provider: fallback.provider,
    models: groupedModels,
    byLevel,
    fallback,
  };
}

function buildModelOptions(models: Model[]): ModelOption[] {
  const grouped = new Map<string, Model[]>();
  for (const model of models) {
    const key = getGroupedOptionKey(model);
    if (!key) continue;
    const current = grouped.get(key);
    if (current) current.push(model);
    else grouped.set(key, [model]);
  }

  const emittedGroups = new Set<string>();
  const options: ModelOption[] = [];
  for (const model of models) {
    const key = getGroupedOptionKey(model);
    if (!key) {
      options.push(createSingleModelOption(model));
      continue;
    }

    const groupedModels = grouped.get(key);
    if (!groupedModels || groupedModels.length < 2) {
      options.push(createSingleModelOption(model));
      continue;
    }

    if (emittedGroups.has(key)) continue;
    emittedGroups.add(key);
    options.push(createGroupedModelOption(key, groupedModels));
  }
  return options;
}

function isThinkingLevelSupported(model: Model, level: ThinkingLevel): boolean {
  if (!model.reasoning) return false;
  return model.thinkingLevelMap?.[level] !== null;
}

function getOptionTargetForThinking(option: ModelOption, level: ThinkingLevel): Model {
  return option.byLevel[level] ?? option.byLevel.medium ?? option.fallback;
}

// Codex-style model picker: a compact trigger in the composer footer that opens a
// tiered menu (model / reasoning level), each row expanding into a submenu.
export function ModelSelector() {
  const { t } = useI18n();
  const session = useStore((s) => s.session);
  const models = useStore((s) => s.models);
  const isStreaming = useStore((s) => s.isStreaming);
  const backendStatus = useStore((s) => s.backendStatus);

  const currentModel = session?.model;
  const thinkingLevel = (session?.thinkingLevel ?? "medium") as ThinkingLevel;
  const modelOptions = useMemo(() => buildModelOptions(models), [models]);
  const activeModelOption = currentModel
    ? modelOptions.find((option) => option.models.some((model) => modelsMatch(model, currentModel)))
    : undefined;
  const inferredThinkingLevel = currentModel ? getModelThinkingLevel(currentModel) : null;
  const effectiveThinkingLevel = inferredThinkingLevel ?? thinkingLevel;
  const rawModelName =
    models.find((m) => m.provider === currentModel?.provider && m.id === currentModel?.id)?.name ??
    currentModel?.id ??
    (backendStatus.ready
      ? t("No model", "无模型")
      : backendStatus.starting || backendStatus.restarting
        ? t("Starting...", "正在启动…")
        : t("Agent offline", "智能体已离线"));
  const modelName = activeModelOption?.label ?? rawModelName;
  const availableThinkingLevels = useMemo(() => {
    if (activeModelOption && getThinkingVariantCount(activeModelOption) > 0) {
      return THINKING_LEVELS.filter((level) => activeModelOption.byLevel[level]);
    }
    if (!currentModel) return [];
    return THINKING_LEVELS.filter((level) => isThinkingLevelSupported(currentModel, level));
  }, [activeModelOption, currentModel]);
  const modelSupportsThinking = availableThinkingLevels.length > 0;

  function thinkingLabel(level: ThinkingLevel): string {
    if (level === "off") return t("Off", "关闭");
    if (level === "minimal") return t("Minimum", "最低");
    if (level === "low") return t("Low", "低");
    if (level === "medium") return t("Medium", "中");
    if (level === "high") return t("High", "高");
    if (level === "xhigh") return t("Extra high", "极高");
    return t("Maximum", "最高");
  }

  function compactModelLabel(value: string): string {
    const trimmed = value.trim();
    const deepseekMatch = /^dee[pk]seek[-_\s]?v?(\d+(?:\.\d+)?)/i.exec(trimmed);
    if (deepseekMatch) return `DeepSeek v${deepseekMatch[1]}`;
    const grokMatch = /^grok[-_\s]?(\d+(?:\.\d+)?)/i.exec(trimmed);
    if (grokMatch) return `grok ${grokMatch[1]}`;
    const gptMatch = /^gpt[-_\s]?(\d+(?:\.\d+)?)/i.exec(trimmed);
    if (gptMatch) return gptMatch[1];
    const claudeMatch = /^claude[-_\s]?([a-z]+)(?:[-_\s]?(\d+(?:\.\d+)?))?/i.exec(trimmed);
    if (claudeMatch) return `Claude ${claudeMatch[1]}${claudeMatch[2] ? ` ${claudeMatch[2]}` : ""}`;
    if (trimmed.length <= 18) return trimmed;
    const parts = trimmed.split(/[-_\s]+/).filter(Boolean);
    if (parts.length >= 2) return parts.slice(0, 2).join(" ");
    return `${trimmed.slice(0, 16)}…`;
  }

  const compactModelName = compactModelLabel(modelName);

  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<Submenu>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSubmenu(null);
      }
    }
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeMenu(true);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const focusFrame = requestAnimationFrame(() => {
      const popover = popoverRef.current;
      if (!popover) return;
      const target =
        submenu === null
          ? popover.querySelector<HTMLElement>('[role="menuitem"]')
          : (popover.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]') ??
            popover.querySelector<HTMLElement>('[role="menuitemradio"]'));
      target?.focus();
    });
    return () => cancelAnimationFrame(focusFrame);
  }, [open, submenu]);

  function closeMenu(restoreFocus = false) {
    setOpen(false);
    setSubmenu(null);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  async function handleSelectModel(option: ModelOption) {
    closeMenu(true);
    const target = getOptionTargetForThinking(option, effectiveThinkingLevel);
    try {
      await api.setModel(target.provider, target.id);
      const targetLevel = getModelThinkingLevel(target);
      if (targetLevel) await api.setThinkingLevel(targetLevel);
      useStore.getState().refreshSession();
    } catch (error) {
      showToast(t("Failed to switch model: {error}", "切换模型失败：{error}", {
        error: error instanceof Error ? error.message : String(error),
      }), "error");
    }
  }

  async function handleSelectThinking(level: ThinkingLevel) {
    closeMenu(true);
    try {
      const target = activeModelOption?.byLevel[level];
      if (target && (!currentModel || !modelsMatch(target, currentModel))) {
        await api.setModel(target.provider, target.id);
      }
      await api.setThinkingLevel(level);
      useStore.getState().refreshSession();
    } catch (error) {
      showToast(
        t("Failed to update reasoning effort: {error}", "更新推理强度失败：{error}", {
          error: error instanceof Error ? error.message : String(error),
        }),
        "error",
      );
    }
  }

  async function handleResetDefaults() {
    if (!modelSupportsThinking) {
      closeMenu(true);
      return;
    }
    closeMenu(true);
    try {
      const resetLevel = availableThinkingLevels.includes("medium") ? "medium" : availableThinkingLevels[0];
      const target = activeModelOption?.byLevel[resetLevel];
      if (target && (!currentModel || !modelsMatch(target, currentModel))) {
        await api.setModel(target.provider, target.id);
      }
      await api.setThinkingLevel(resetLevel);
      useStore.getState().refreshSession();
    } catch (error) {
      showToast(
        t("Failed to reset model settings: {error}", "重置模型设置失败：{error}", {
          error: error instanceof Error ? error.message : String(error),
        }),
        "error",
      );
    }
  }

  function handlePopoverKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const popover = popoverRef.current;
    if (!popover) return;
    const items = Array.from(
      popover.querySelectorAll<HTMLButtonElement>('[role="menuitem"], [role="menuitemradio"]'),
    ).filter((item) => item.getClientRects().length > 0 && !item.disabled);
    if (items.length === 0) return;

    event.preventDefault();
    event.stopPropagation();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else if (event.key === "ArrowUp") nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
    else nextIndex = currentIndex < 0 || currentIndex === items.length - 1 ? 0 : currentIndex + 1;
    items[nextIndex]?.focus();
  }

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="model-picker-trigger"
        onClick={() => {
          if (open) closeMenu();
          else setOpen(true);
        }}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        disabled={isStreaming || !backendStatus.ready}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={popoverId}
        title={backendStatus.ready
          ? t("Select model", "选择模型")
          : t("The agent backend is not ready", "智能体后端尚未就绪")}
      >
        <span className="model-picker-bolt" aria-hidden="true">
          <Icon name="zap" size={13} />
        </span>
        <span className="model-picker-name">{compactModelName}</span>
        {modelSupportsThinking && effectiveThinkingLevel !== "off" && (
          <span className="model-picker-thinking">{thinkingLabel(effectiveThinkingLevel)}</span>
        )}
        <span className="model-picker-chevron" aria-hidden="true">
          <Icon name="chevron-down" size={12} strokeWidth={2} />
        </span>
      </button>

      {open && (
        <div
          id={popoverId}
          ref={popoverRef}
          className={`model-picker-popover ${submenu ? "has-submenu" : ""}`}
          role="menu"
          onKeyDown={handlePopoverKeyDown}
          onBlur={(event) => {
            if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
            closeMenu();
          }}
        >
          <div className="model-picker-panel model-picker-main-panel">
              <button
                type="button"
                className="model-picker-row"
                role="menuitem"
                tabIndex={-1}
                onClick={() => setSubmenu("model")}
              >
                <span className="model-picker-row-label">{t("Model", "模型")}</span>
                <span className="model-picker-row-value">{modelName}</span>
                <span className="model-picker-row-arrow" aria-hidden="true">&#8250;</span>
              </button>
              {modelSupportsThinking && (
                <button
                  type="button"
                  className="model-picker-row"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => setSubmenu("thinking")}
                >
                  <span className="model-picker-row-label">{t("Reasoning effort", "推理强度")}</span>
                  <span className="model-picker-row-value">{thinkingLabel(effectiveThinkingLevel)}</span>
                  <span className="model-picker-row-arrow" aria-hidden="true">&#8250;</span>
                </button>
              )}
          </div>

          {submenu === "model" && (
            <div className="model-picker-panel model-picker-submenu-panel">
              <button
                type="button"
                className="model-picker-back"
                onClick={() => setSubmenu(null)}
                role="menuitem"
                tabIndex={-1}
              >
                <span aria-hidden="true">&#8249;</span>
                <span>{t("Model", "模型")}</span>
              </button>
              <div className="model-picker-sublist">
                {modelOptions.length === 0 && (
                  <div className="model-picker-empty">{t("No models available", "没有可用模型")}</div>
                )}
                {modelOptions.map((option) => {
                  const active = currentModel
                    ? option.models.some((model) => modelsMatch(model, currentModel))
                    : false;
                  const variantCount = getThinkingVariantCount(option);
                  return (
                    <button
                      key={option.key}
                      type="button"
                      className={`model-picker-suboption ${active ? "active" : ""}`}
                      role="menuitemradio"
                      tabIndex={-1}
                      aria-checked={active}
                      onClick={() => handleSelectModel(option)}
                    >
                      <span className="model-picker-suboption-copy">
                        <span className="model-picker-suboption-name">{option.label}</span>
                        <span className="model-picker-suboption-provider">
                          {variantCount > 1
                            ? t("{provider} · {count} reasoning levels", "{provider} · {count} 种推理强度", {
                              provider: option.provider,
                              count: variantCount,
                            })
                            : option.provider}
                        </span>
                      </span>
                      {active && (
                        <span className="model-picker-check" aria-hidden="true">
                          <Icon name="check" size={14} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {submenu === "thinking" && (
            <div className="model-picker-panel model-picker-submenu-panel model-picker-thinking-panel">
              <button
                type="button"
                className="model-picker-back"
                onClick={() => setSubmenu(null)}
                role="menuitem"
                tabIndex={-1}
              >
                <span aria-hidden="true">&#8249;</span>
                <span>{t("Reasoning effort", "推理强度")}</span>
              </button>
              <div className="model-picker-sublist">
                {availableThinkingLevels.map((level) => {
                  const active = level === effectiveThinkingLevel;
                  return (
                    <button
                      key={level}
                      type="button"
                      className={`model-picker-suboption ${active ? "active" : ""}`}
                      role="menuitemradio"
                      tabIndex={-1}
                      aria-checked={active}
                      onClick={() => handleSelectThinking(level)}
                    >
                      <span className="model-picker-suboption-name">{thinkingLabel(level)}</span>
                      {active && (
                        <span className="model-picker-check" aria-hidden="true">
                          <Icon name="check" size={14} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
