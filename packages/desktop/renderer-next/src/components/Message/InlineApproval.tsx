import * as api from "../../ipc/api";
import { useStore } from "../../store";
import type { ExtensionUIRequestEvent } from "../../ipc/types";

// Renders a pending extension UI request (tool-approval confirm / select) as an
// inline card in the message stream, Codex-style, rather than a modal dialog.
// The backend keeps the tool call suspended until we send an
// extension_ui_response, so Allow/Deny here directly gate tool execution.
export function InlineApproval({ request }: { request: ExtensionUIRequestEvent }) {
  const removeRequest = useStore((s) => s.removeExtensionUIRequest);

  function respond(response: Record<string, unknown>) {
    api.sendExtensionUIResponse(request.id, response).catch(() => {
      // Send failures surface via the backend log stream; still clear locally.
    });
    removeRequest(request.id);
  }

  if (request.method === "select") {
    return <SelectApproval request={request} onRespond={respond} />;
  }
  return <ConfirmApproval request={request} onRespond={respond} />;
}

function ConfirmApproval({
  request,
  onRespond,
}: {
  request: ExtensionUIRequestEvent;
  onRespond: (response: Record<string, unknown>) => void;
}) {
  const title = typeof request.title === "string" ? request.title : "Approve action?";
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
          onClick={() => onRespond({ confirmed: false })}
        >
          Deny
        </button>
        <button
          className="dialog-btn dialog-btn-primary"
          type="button"
          onClick={() => onRespond({ confirmed: true })}
        >
          Allow
        </button>
      </div>
    </div>
  );
}

function SelectApproval({
  request,
  onRespond,
}: {
  request: ExtensionUIRequestEvent;
  onRespond: (response: Record<string, unknown>) => void;
}) {
  const title = typeof request.title === "string" ? request.title : "Choose an option";
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
            onClick={() => onRespond({ value: option })}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
