import type { Message } from "../../ipc/types";
import { findLastReplyCopyText } from "../CommandPalette/copyLastReply";
import { findLatestTaskPlan } from "./planState";
import { collectTaskArtifacts } from "./taskResources";

export interface TaskDeliverySummary {
  status: "running" | "ready" | "empty";
  lastReply: string | null;
  completedPlanSteps: number;
  totalPlanSteps: number;
  artifactCount: number;
}

export function summarizeTaskDelivery(
  messages: readonly Message[],
  isStreaming: boolean,
): TaskDeliverySummary {
  const plan = findLatestTaskPlan(messages);
  return {
    status: isStreaming ? "running" : messages.length > 0 ? "ready" : "empty",
    lastReply: findLastReplyCopyText(messages),
    completedPlanSteps: plan?.steps.filter((step) => step.status === "completed").length ?? 0,
    totalPlanSteps: plan?.steps.length ?? 0,
    artifactCount: collectTaskArtifacts(messages).length,
  };
}
