import { useEffect, useRef, useState } from "react";
import { useStore, type PermissionMode } from "../../store";

interface ModeOption {
  mode: PermissionMode;
  label: string;
  description: string;
}

// Ordered most-permissive to least, matching the Codex-style picker.
const MODE_OPTIONS: ModeOption[] = [
  {
    mode: "full",
    label: "完全访问",
    description: "所有操作自动执行，不打断",
  },
  {
    mode: "auto",
    label: "替我审批",
    description: "仅对检测到的风险操作请求批准",
  },
  {
    mode: "ask",
    label: "请求批准",
    description: "每次改文件或跑命令前都询问",
  },
];

function optionFor(mode: PermissionMode): ModeOption {
  return MODE_OPTIONS.find((o) => o.mode === mode) ?? MODE_OPTIONS[2];
}

export function PermissionSelector() {
  const permissionMode = useStore((s) => s.permissionMode);
  const setPermissionMode = useStore((s) => s.setPermissionMode);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the popover on any outside click.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const active = optionFor(permissionMode);

  return (
    <div className="permission-selector" ref={rootRef}>
      <button
        type="button"
        className={`permission-trigger permission-mode-${permissionMode}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Tool permission mode"
      >
        <span className="permission-dot" aria-hidden="true" />
        <span className="permission-trigger-label">{active.label}</span>
        <span className="permission-chevron" aria-hidden="true">{open ? "\u25be" : "\u25b8"}</span>
      </button>
      {open && (
        <div className="permission-popover" role="listbox" aria-label="Permission mode">
          <div className="permission-popover-title">如何批准工具操作？</div>
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              role="option"
              aria-selected={option.mode === permissionMode}
              className={`permission-option ${option.mode === permissionMode ? "active" : ""}`}
              onClick={() => {
                setPermissionMode(option.mode);
                setOpen(false);
              }}
            >
              <div className="permission-option-body">
                <span className="permission-option-label">{option.label}</span>
                <span className="permission-option-desc">{option.description}</span>
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
