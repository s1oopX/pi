import type { Message } from "../../ipc/types";

export type TaskPlanStepStatus = "pending" | "in_progress" | "completed";

export interface TaskPlanStep {
  step: string;
  status: TaskPlanStepStatus;
}

export interface TaskPlanState {
  explanation?: string;
  steps: TaskPlanStep[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTaskPlan(value: unknown): TaskPlanState | null {
  if (!isRecord(value) || !Array.isArray(value.plan)) return null;
  if (value.explanation !== undefined && typeof value.explanation !== "string") return null;

  const steps: TaskPlanStep[] = [];
  for (const item of value.plan) {
    if (!isRecord(item) || typeof item.step !== "string" || item.step.trim().length === 0) return null;
    if (item.status !== "pending" && item.status !== "in_progress" && item.status !== "completed") return null;
    steps.push({ step: item.step.trim(), status: item.status });
  }

  const explanation = value.explanation?.trim();
  return { ...(explanation ? { explanation } : {}), steps };
}

export function findLatestTaskPlan(messages: readonly Message[]): TaskPlanState | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex];
    if (message.role !== "assistant") continue;
    for (let blockIndex = message.content.length - 1; blockIndex >= 0; blockIndex--) {
      const block = message.content[blockIndex];
      if (block.type !== "toolCall" || block.name !== "update_plan") continue;
      const plan = parseTaskPlan(block.arguments);
      if (plan) return plan;
    }
  }
  return null;
}
