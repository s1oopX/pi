import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import * as api from "../../ipc/api";
import { useI18n } from "../../i18n";
import { useStore } from "../../store";
import type { ExtensionUIRequestEvent } from "../../ipc/types";

type ApprovalResponse = Record<string, unknown>;
type RespondToApproval = (response: ApprovalResponse) => Promise<void>;

export { isInteractiveExtensionUIRequest } from "../../ipc/extensionUIEffects";

export function createTextApprovalResponse(value: string): ApprovalResponse {
  return { value };
}

export function createCancelledApprovalResponse(): ApprovalResponse {
  return { cancelled: true };
}

// Renders a pending extension dialog request as an inline card in the message
// stream. The backend remains suspended until extension_ui_response arrives.
export function InlineApproval({ request }: { request: ExtensionUIRequestEvent }) {
  const removeRequest = useStore((s) => s.removeExtensionUIRequest);
  const respondingRef = useRef(false);
  const [responding, setResponding] = useState(false);
  const [responseError, setResponseError] = useState<string | null>(null);

  async function respond(response: ApprovalResponse): Promise<void> {
    if (respondingRef.current) return;
    respondingRef.current = true;
    setResponding(true);
    setResponseError(null);
    try {
      await api.sendExtensionUIResponse(request.id, response);
      removeRequest(request.id);
    } catch (error) {
      respondingRef.current = false;
      setResponding(false);
      setResponseError(error instanceof Error ? error.message : String(error));
    }
  }

  const sharedProps = { onRespond: respond, responding, responseError };
  if (request.method === "select") {
    return <SelectApproval request={request} {...sharedProps} />;
  }
  if (request.method === "input") {
    return <TextApproval request={request} multiline={false} {...sharedProps} />;
  }
  if (request.method === "editor") {
    return <TextApproval request={request} multiline {...sharedProps} />;
  }
  return <ConfirmApproval request={request} {...sharedProps} />;
}

interface ApprovalInteractionProps {
  onRespond: RespondToApproval;
  responding: boolean;
  responseError: string | null;
}

function ConfirmApproval({
  request,
  onRespond,
  responding,
  responseError,
}: { request: ExtensionUIRequestEvent } & ApprovalInteractionProps) {
  const { t } = useI18n();
  const title = typeof request.title === "string" ? request.title : t("Approve action?", "批准此操作？");
  const message = typeof request.message === "string" ? request.message : "";

  return (
    <div className="inline-approval" role="alertdialog" aria-label={title}>
      <div className="inline-approval-header">
        <span className="inline-approval-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="15" height="15">
            <path
              d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="inline-approval-title">{title}</span>
      </div>
      {message && <pre className="inline-approval-detail">{message}</pre>}
      <div className="inline-approval-actions">
        <button
          className="dialog-btn dialog-btn-danger"
          type="button"
          disabled={responding}
          onClick={() => void onRespond({ confirmed: false })}
        >
          {t("Deny", "拒绝")}
        </button>
        <button
          className="dialog-btn dialog-btn-primary"
          type="button"
          disabled={responding}
          onClick={() => void onRespond({ confirmed: true })}
        >
          {responding ? t("Responding...", "正在响应...") : t("Allow", "允许")}
        </button>
      </div>
      <ApprovalResponseError message={responseError} />
    </div>
  );
}

function SelectApproval({
  request,
  onRespond,
  responding,
  responseError,
}: { request: ExtensionUIRequestEvent } & ApprovalInteractionProps) {
  const { t } = useI18n();
  const title = typeof request.title === "string" ? request.title : t("Choose an option", "选择一个选项");
  const options = Array.isArray(request.options) ? (request.options as string[]) : [];

  return (
    <div className="inline-approval" role="alertdialog" aria-label={title}>
      <div className="inline-approval-header">
        <span className="inline-approval-title">{title}</span>
      </div>
      <div className="inline-approval-actions">
        {options.map((option) => (
          <button
            key={option}
            className="dialog-btn dialog-btn-secondary"
            type="button"
            disabled={responding}
            onClick={() => void onRespond({ value: option })}
          >
            {option}
          </button>
        ))}
      </div>
      <ApprovalResponseError message={responseError} />
    </div>
  );
}

function TextApproval({
  request,
  multiline,
  onRespond,
  responding,
  responseError,
}: {
  request: ExtensionUIRequestEvent;
  multiline: boolean;
} & ApprovalInteractionProps) {
  const { t } = useI18n();
  const title = typeof request.title === "string"
    ? request.title
    : multiline
      ? t("Edit text", "编辑文本")
      : t("Enter a value", "输入值");
  const initialValue = multiline && typeof request.prefill === "string" ? request.prefill : "";
  const placeholder = !multiline && typeof request.placeholder === "string" ? request.placeholder : undefined;
  const [value, setValue] = useState(initialValue);
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const titleId = useId();
  const fieldId = useId();
  const hintId = useId();

  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!responding) void onRespond(createTextApprovalResponse(value));
  }

  function cancel() {
    if (!responding) void onRespond(createCancelledApprovalResponse());
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }
    if (multiline && event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  }

  const assignFieldRef = (node: HTMLInputElement | HTMLTextAreaElement | null) => {
    fieldRef.current = node;
  };

  return (
    <form
      className="inline-approval inline-approval-text"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={hintId}
      onSubmit={submit}
    >
      <div className="inline-approval-header">
        <span className="inline-approval-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="15" height="15">
            <path d="M4 4h16v16H4zM8 9h8M8 13h8M8 17h5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <label id={titleId} className="inline-approval-title" htmlFor={fieldId}>
          {title}
        </label>
      </div>
      {multiline ? (
        <textarea
          ref={assignFieldRef}
          id={fieldId}
          className="inline-approval-field inline-approval-editor"
          value={value}
          disabled={responding}
          aria-label={title}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <input
          ref={assignFieldRef}
          id={fieldId}
          className="inline-approval-field"
          type="text"
          value={value}
          placeholder={placeholder}
          disabled={responding}
          aria-label={title}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
        />
      )}
      <span id={hintId} className="inline-approval-hint">
        {multiline
          ? t("Ctrl/Cmd+Enter to submit · Escape to cancel", "按 Ctrl/Cmd+Enter 提交 · 按 Escape 取消")
          : t("Enter to submit · Escape to cancel", "按 Enter 提交 · 按 Escape 取消")}
      </span>
      <div className="inline-approval-actions">
        <button
          className="dialog-btn dialog-btn-secondary"
          type="button"
          disabled={responding}
          onClick={cancel}
        >
          {t("Cancel", "取消")}
        </button>
        <button className="dialog-btn dialog-btn-primary" type="submit" disabled={responding}>
          {responding ? t("Submitting...", "正在提交...") : t("Submit", "提交")}
        </button>
      </div>
      <ApprovalResponseError message={responseError} />
    </form>
  );
}

function ApprovalResponseError({ message }: { message: string | null }) {
  const { t } = useI18n();
  if (!message) return null;
  return (
    <p className="inline-approval-response-error" role="alert">
      {t("Could not send response: {message}", "无法发送响应：{message}", { message })}
    </p>
  );
}
