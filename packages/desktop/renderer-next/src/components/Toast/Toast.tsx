import { useEffect, useState, useCallback } from "react";

export interface ToastItem {
  id: string;
  message: string;
  type?: "info" | "success" | "error";
  duration?: number;
}

let toastId = 0;
const listeners = new Set<(toast: ToastItem) => void>();

export function showToast(message: string, type: ToastItem["type"] = "info", duration = 4000): void {
  const toast: ToastItem = { id: String(++toastId), message, type, duration };
  listeners.forEach((fn) => fn(toast));
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((toast: ToastItem) => {
    setToasts((prev) => [...prev, toast]);
  }, []);

  useEffect(() => {
    listeners.add(addToast);
    return () => { listeners.delete(addToast); };
  }, [addToast]);

  function removeToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div className="toast-region" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <ToastEntry key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
      ))}
    </div>
  );
}

function ToastEntry({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, toast.duration ?? 4000);
    return () => clearTimeout(timer);
  }, [toast.duration, onDismiss]);

  return (
    <div className={`toast toast-${toast.type ?? "info"}`} role="alert">
      <span className="toast-message">{toast.message}</span>
      <button className="toast-dismiss" type="button" onClick={onDismiss} aria-label="Dismiss">
        &times;
      </button>
    </div>
  );
}
