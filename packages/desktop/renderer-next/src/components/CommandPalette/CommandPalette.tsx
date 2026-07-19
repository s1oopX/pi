import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n";
import {
  formatAppKeybinding,
  toAriaKeyshortcuts,
  type AppKeybindings,
  type AppPlatform,
} from "../../keybindings/appKeybindings";
import {
  filterCommandPaletteEntries,
  findCommandPaletteEdge,
  localizeCommandPaletteEntries,
  moveCommandPaletteSelection,
  type CommandPaletteEntry,
  type PaletteCommandId,
} from "./commandPaletteState";
import "./CommandPalette.css";

interface CommandPaletteProps {
  entries: readonly CommandPaletteEntry[];
  keybindings: AppKeybindings;
  platform: AppPlatform;
  onClose: () => void;
  onRun: (commandId: PaletteCommandId) => void;
}

export function CommandPalette({ entries, keybindings, platform, onClose, onRun }: CommandPaletteProps) {
  const { resolvedLanguage, t } = useI18n();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef(true);
  const listboxId = useId();
  const titleId = useId();
  const localizedEntries = useMemo(
    () => localizeCommandPaletteEntries(entries, resolvedLanguage),
    [entries, resolvedLanguage],
  );
  const visibleEntries = useMemo(
    () => filterCommandPaletteEntries(localizedEntries, query),
    [localizedEntries, query],
  );
  const activeEntry = activeIndex >= 0 ? visibleEntries[activeIndex] : undefined;

  useEffect(() => {
    setActiveIndex(findCommandPaletteEdge(visibleEntries, "first"));
  }, [visibleEntries]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const inertTargets = [
      document.querySelector<HTMLElement>(".window-chrome"),
      document.querySelector<HTMLElement>(".app-shell"),
      document.querySelector<HTMLElement>(".settings-overlay"),
    ].filter((element): element is HTMLElement => element !== null);
    const priorInertState = inertTargets.map((element) => element.hasAttribute("inert"));
    for (const element of inertTargets) element.setAttribute("inert", "");

    const focusFrame = requestAnimationFrame(() => inputRef.current?.focus());
    function containFocus(event: FocusEvent) {
      if (!(event.target instanceof Node) || panelRef.current?.contains(event.target)) return;
      inputRef.current?.focus();
    }
    document.addEventListener("focusin", containFocus);

    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("focusin", containFocus);
      inertTargets.forEach((element, index) => {
        if (!priorInertState[index]) element.removeAttribute("inert");
      });
      if (restoreFocusRef.current && previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  function close(restoreFocus: boolean): void {
    restoreFocusRef.current = restoreFocus;
    onClose();
  }

  function run(entry: CommandPaletteEntry | undefined): void {
    if (!entry || entry.disabled) return;
    restoreFocusRef.current = false;
    onRun(entry.id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      inputRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => moveCommandPaletteSelection(visibleEntries, current, event.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(findCommandPaletteEdge(visibleEntries, event.key === "Home" ? "first" : "last"));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      run(activeEntry);
    }
  }

  function handleBackdropMouseDown(event: MouseEvent<HTMLDivElement>): void {
    if (event.target === event.currentTarget) close(true);
  }

  return createPortal(
    <div className="command-palette-overlay" onMouseDown={handleBackdropMouseDown}>
      <div
        ref={panelRef}
        className="command-palette"
        data-app-command-palette
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="command-palette-title">
          {t("Command Palette", "命令面板")}
        </h2>
        <div className="command-palette-search">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="m12 12 4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded="true"
            aria-activedescendant={activeEntry ? `${listboxId}-${activeEntry.id}` : undefined}
            aria-label={t("Search commands", "搜索命令")}
            autoComplete="off"
            spellCheck={false}
            value={query}
            placeholder={t("Type a command", "输入命令")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd>{formatAppKeybinding(keybindings["open-command-palette"], platform)}</kbd>
        </div>

        <div
          id={listboxId}
          className="command-palette-results"
          role="listbox"
          aria-label={t("Commands", "命令")}
        >
          {visibleEntries.map((entry, index) => {
            const binding = keybindings[entry.id];
            return (
              <button
                id={`${listboxId}-${entry.id}`}
                className={`command-palette-item ${index === activeIndex ? "active" : ""}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                aria-disabled={entry.disabled || undefined}
                aria-keyshortcuts={toAriaKeyshortcuts(binding, platform)}
                tabIndex={-1}
                disabled={entry.disabled}
                key={entry.id}
                onMouseMove={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => run(entry)}
              >
                <span className="command-palette-item-copy">
                  <strong>{entry.label}</strong>
                  <span>{entry.disabledReason ?? entry.description}</span>
                </span>
                <kbd>{formatAppKeybinding(binding, platform)}</kbd>
              </button>
            );
          })}
          {visibleEntries.length === 0 && (
            <div className="command-palette-empty" role="status">
              {t("No commands found", "未找到命令")}
            </div>
          )}
        </div>

        <div className="command-palette-footer" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> {t("Navigate", "导航")}</span>
          <span><kbd>Enter</kbd> {t("Run", "运行")}</span>
          <span><kbd>Esc</kbd> {t("Close", "关闭")}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
