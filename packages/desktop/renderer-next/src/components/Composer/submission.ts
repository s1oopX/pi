export type StreamingSubmitMode = "follow-up" | "steer";

export type PromptStreamingBehavior = "followUp" | "steer" | undefined;

export function isPromptSubmissionBlocked(retrying: boolean, compacting: boolean): boolean {
  return retrying || compacting;
}

export function shouldSubmitComposerEnter(key: string, shiftKey: boolean, isComposing: boolean): boolean {
  return key === "Enter" && !shiftKey && !isComposing;
}

export function resolvePromptStreamingBehavior(
  isStreaming: boolean,
  message: string,
  streamingMode: StreamingSubmitMode,
): PromptStreamingBehavior {
  if (!isStreaming || message.startsWith("/")) return undefined;
  return streamingMode === "follow-up" ? "followUp" : "steer";
}
