import { useEffect, useId, useRef, type ReactNode } from "react";
import { useI18n } from "../../i18n";

interface DialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
  className?: string;
}

export function Dialog({ open, title, children, actions, onClose, className }: DialogProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  function restoreFocus(): void {
    const target = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (!target?.isConnected) return;
    requestAnimationFrame(() => target.focus());
  }

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      el.showModal();
    } else if (!open && el.open) {
      el.close();
      restoreFocus();
    }
  }, [open]);

  useEffect(() => () => {
    restoreFocus();
  }, []);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === dialogRef.current) {
      onClose?.();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={`app-dialog${className ? ` ${className}` : ""}`}
      onClick={handleBackdropClick}
      onCancel={(event) => {
        event.preventDefault();
        onClose?.();
      }}
      aria-labelledby={titleId}
    >
      <div className="dialog-inner">
        <div className="dialog-header">
          <h2 id={titleId} className="dialog-title">{title}</h2>
          {onClose && (
            <button
              className="icon-button dialog-close"
              type="button"
              onClick={onClose}
              aria-label={t("Close", "关闭")}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        <div className="dialog-body">{children}</div>
        {actions && <div className="dialog-actions">{actions}</div>}
      </div>
    </dialog>
  );
}
