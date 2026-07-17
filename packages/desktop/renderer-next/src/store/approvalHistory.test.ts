import { describe, expect, it } from "vitest";
import {
  appendApprovalHistory,
  approvalHistoryLabel,
  decisionFromResponse,
  summarizeApprovalRequest,
} from "./approvalHistory";

describe("approvalHistory", () => {
  it("summarizes request params", () => {
    expect(summarizeApprovalRequest({
      method: "confirm",
      params: { title: "Run tests", message: "npm test" },
    })).toBe("Run tests");
    expect(summarizeApprovalRequest({
      method: "bash",
      params: { command: "ls -la" },
    })).toBe("ls -la");
  });

  it("classifies response decisions", () => {
    expect(decisionFromResponse("confirm", true)).toBe("approved");
    expect(decisionFromResponse("confirm", false)).toBe("rejected");
    expect(decisionFromResponse("input", null)).toBe("cancelled");
    expect(decisionFromResponse("editor", { text: "hi" })).toBe("responded");
  });

  it("caps history length", () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({
      id: String(i),
      method: "confirm",
      summary: `s${i}`,
      decision: "approved" as const,
      timestamp: i,
    }));
    expect(appendApprovalHistory([], entries[0], 50)).toHaveLength(1);
    let acc = appendApprovalHistory([], entries[0], 3);
    acc = appendApprovalHistory(acc, entries[1], 3);
    acc = appendApprovalHistory(acc, entries[2], 3);
    acc = appendApprovalHistory(acc, entries[3], 3);
    expect(acc).toHaveLength(3);
    expect(acc[0].id).toBe("1");
  });

  it("formats labels", () => {
    expect(approvalHistoryLabel({
      id: "1",
      method: "confirm",
      summary: "Run npm test",
      decision: "approved",
      timestamp: 1,
    })).toBe("Approved: Run npm test");
  });
});
