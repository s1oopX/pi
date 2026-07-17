import { useEffect, useState, useCallback } from "react";
import { useI18n } from "../../i18n";

export interface ToastItem {
  id: string;
  message: string;
  type?: "info" | "success" | "warning" | "error";
  duration?: number;
}

let toastId = 0;
const MAX_TOASTS = 3;
const listeners = new Set<(toast: ToastItem) => void>();

export function showToast(message: string, type: ToastItem["type"] = "info", duration = 4000): void {
  const toast: ToastItem = { id: String(++toastId), message, type, duration };
  listeners.forEach((fn) => fn(toast));
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((toast: ToastItem) => {
    setToasts((prev) => [...prev, toast].slice(-MAX_TOASTS));
  }, []);

  useEffect(() => {
    listeners.add(addToast);
    return () => { listeners.delete(addToast); };
  }, [addToast]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <div className="toast-region">
      {toasts.map((toast) => (
        <ToastEntry key={toast.id} toast={toast} onDismiss={removeToast} />
      ))}
    </div>
  );
}

function ToastEntry({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const { t } = useI18n();
  const dismiss = useCallback(() => onDismiss(toast.id), [onDismiss, toast.id]);

  useEffect(() => {
    const timer = setTimeout(dismiss, toast.duration ?? 4000);
    return () => clearTimeout(timer);
  }, [dismiss, toast.duration]);

  const isError = toast.type === "error";

  return (
    <div
      className={`toast toast-${toast.type ?? "info"}`}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <span className="toast-message">{toast.message}</span>
      <button
        className="toast-dismiss"
        type="button"
        onClick={dismiss}
        aria-label={t("Dismiss", "关闭通知")}
      >
        &times;
      </button>
    </div>
  );
}
