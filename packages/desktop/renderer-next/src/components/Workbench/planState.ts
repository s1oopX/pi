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

export interface TaskGoalState {
  objective: string;
  status: "active" | "complete" | "blocked";
  tokenBudget?: number;
  tokensUsed?: number;
  remainingTokens?: number;
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

function parseTaskGoal(value: unknown): TaskGoalState | null {
  if (!isRecord(value) || typeof value.objective !== "string") return null;
  if (value.status !== "active" && value.status !== "complete" && value.status !== "blocked") return null;
  const objective = value.objective.trim();
  if (!objective) return null;
  for (const key of ["tokenBudget", "tokensUsed", "remainingTokens"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "number") return null;
  }
  return {
    objective,
    status: value.status,
    ...(typeof value.tokenBudget === "number" ? { tokenBudget: value.tokenBudget } : {}),
    ...(typeof value.tokensUsed === "number" ? { tokensUsed: value.tokensUsed } : {}),
    ...(typeof value.remainingTokens === "number" ? { remainingTokens: value.remainingTokens } : {}),
  };
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

export function findLatestTaskGoal(messages: readonly Message[]): TaskGoalState | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex];
    if (message.role !== "toolResult" || message.isError) continue;
    if (message.toolName !== "create_goal" && message.toolName !== "get_goal" && message.toolName !== "update_goal") continue;
    const goal = parseTaskGoal(message.details);
    if (goal) return goal;
  }
  return null;
}
