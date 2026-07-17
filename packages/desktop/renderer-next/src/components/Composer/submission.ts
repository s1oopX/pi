export type StreamingSubmitMode = "follow-up" | "steer";

export type PromptStreamingBehavior = "followUp" | "steer" | undefined;

export function resolvePromptStreamingBehavior(
  isStreaming: boolean,
  message: string,
  streamingMode: StreamingSubmitMode,
): PromptStreamingBehavior {
  if (!isStreaming || message.startsWith("/")) return undefined;
  return streamingMode === "follow-up" ? "followUp" : "steer";
}
