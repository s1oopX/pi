/**
 * Transcript-facing records for completed extension UI approvals.
 */

export type ApprovalHistoryDecision = "approved" | "rejected" | "cancelled" | "responded";

export interface ApprovalHistoryEntry {
  id: string;
  method: string;
  summary: string;
  decision: ApprovalHistoryDecision;
  timestamp: number;
}

export function summarizeApprovalRequest(request: {
  method: string;
  params?: Record<string, unknown>;
}): string {
  const params = request.params ?? {};
  const title = typeof params.title === "string" ? params.title.trim() : "";
  const message = typeof params.message === "string" ? params.message.trim() : "";
  const command = typeof params.command === "string" ? params.command.trim() : "";
  const path = typeof params.path === "string"
    ? params.path.trim()
    : typeof params.file_path === "string"
      ? params.file_path.trim()
      : "";

  if (title) return title;
  if (message) return message.length > 120 ? `${message.slice(0, 119)}…` : message;
  if (command) return command.length > 120 ? `${command.slice(0, 119)}…` : command;
  if (path) return path;
  return request.method || "approval";
}

export function decisionFromResponse(
  method: string,
  response: unknown,
): ApprovalHistoryDecision {
  if (response === false || response === "reject" || response === "denied") return "rejected";
  if (response === true || response === "allow" || response === "approve") return "approved";
  if (response === null || response === undefined || response === "cancel") return "cancelled";
  if (typeof response === "object" && response !== null) {
    const record = response as Record<string, unknown>;
    if (record.cancelled === true || record.action === "cancel") return "cancelled";
    if (record.action === "reject" || record.approved === false) return "rejected";
    if (record.action === "approve" || record.approved === true) return "approved";
  }
  // Input/editor dialogs still count as a completed interaction.
  if (method.includes("input") || method.includes("editor") || method.includes("select")) {
    return "responded";
  }
  return "responded";
}

export function appendApprovalHistory(
  entries: readonly ApprovalHistoryEntry[],
  entry: ApprovalHistoryEntry,
  limit = 50,
): ApprovalHistoryEntry[] {
  return [...entries, entry].slice(-limit);
}

export function approvalHistoryLabel(
  entry: ApprovalHistoryEntry,
  language: "en" | "zh-CN" = "en",
): string {
  const decision =
    language === "zh-CN"
      ? ({
          approved: "已批准",
          rejected: "已拒绝",
          cancelled: "已取消",
          responded: "已回复",
        } as const)[entry.decision]
      : ({
          approved: "Approved",
          rejected: "Rejected",
          cancelled: "Cancelled",
          responded: "Responded",
        } as const)[entry.decision];
  return `${decision}: ${entry.summary}`;
}
