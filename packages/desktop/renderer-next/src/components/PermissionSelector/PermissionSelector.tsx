import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useI18n } from "../../i18n";
import { useStore } from "../../store";
import { optionForPermissionMode, PERMISSION_MODE_OPTIONS } from "./permissionModes";

export function PermissionSelector() {
  const { t } = useI18n();
  const permissionMode = useStore((s) => s.permissionMode);
  const setPermissionMode = useStore((s) => s.setPermissionMode);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  // Close the popover on any outside click.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
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
      const target =
        popover?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]') ??
        popover?.querySelector<HTMLElement>('[role="option"]');
      target?.focus();
    });
    return () => cancelAnimationFrame(focusFrame);
  }, [open]);

  function closeMenu(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function handlePopoverKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const popover = popoverRef.current;
    if (!popover) return;
    const items = Array.from(popover.querySelectorAll<HTMLButtonElement>('[role="option"]')).filter(
      (item) => item.getClientRects().length > 0 && !item.disabled,
    );
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

  const active = optionForPermissionMode(permissionMode);

  function optionLabel(mode: typeof permissionMode): string {
    if (mode === "full") return t("Full access", "完全访问");
    if (mode === "auto") return t("Auto approve", "自动批准");
    return t("Ask every time", "每次询问");
  }

  function optionDescription(mode: typeof permissionMode): string {
    if (mode === "full") return t("Run all tool actions without asking.", "无需询问即可运行所有工具操作。");
    if (mode === "auto") return t("Ask only for potentially risky operations.", "仅对可能有风险的操作进行询问。");
    return t("Ask before commands or file changes.", "运行命令或更改文件前询问。");
  }

  return (
    <div className="permission-selector" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`permission-trigger permission-mode-${permissionMode}`}
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
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={popoverId}
        title={t("Tool permission mode", "工具权限模式")}
      >
        <span className="permission-dot" aria-hidden="true" />
        <span className="permission-trigger-label">{optionLabel(active.mode)}</span>
        <span className="permission-chevron" aria-hidden="true">{open ? "\u25be" : "\u25b8"}</span>
      </button>
      {open && (
        <div
          id={popoverId}
          ref={popoverRef}
          className="permission-popover"
          role="listbox"
          aria-label={t("Permission mode", "权限模式")}
          onKeyDown={handlePopoverKeyDown}
          onBlur={(event) => {
            if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
            closeMenu();
          }}
        >
          <div className="permission-popover-title">{t("Tool permissions", "工具权限")}</div>
          {PERMISSION_MODE_OPTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={option.mode === permissionMode}
              className={`permission-option ${option.mode === permissionMode ? "active" : ""}`}
              onClick={() => {
                setPermissionMode(option.mode);
                closeMenu(true);
              }}
            >
              <div className="permission-option-body">
                <span className="permission-option-label">{optionLabel(option.mode)}</span>
                <span className="permission-option-desc">{optionDescription(option.mode)}</span>
              </div>
              {option.mode === permissionMode && (
                <span className="permission-check" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="14" height="14">
                    <path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
