import type { Message } from "./types.ts";

export function hasCopilotVisionInput(_messages: Message[]): boolean {
	return false;
}

export function buildCopilotDynamicHeaders(_params: {
	messages: Message[];
	hasImages: boolean;
}): Record<string, string> {
	return {};
}
