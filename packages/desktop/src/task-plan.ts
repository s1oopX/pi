import { Type } from "typebox";
import type { ExtensionAPI } from "../../coding-agent/src/index.ts";

export function taskPlanExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "update_plan",
		label: "Update plan",
		description: "Create or replace the current task plan shown in Pi Studio.",
		promptSnippet: "Create or update the task plan shown in Pi Studio",
		promptGuidelines: [
			"Use update_plan for complex tasks with multiple meaningful steps; skip it for simple requests.",
			"Keep at most one plan step in_progress while work remains.",
			"Call update_plan promptly as step statuses change and before the final response.",
		],
		parameters: Type.Object({
			explanation: Type.Optional(Type.String({ description: "Why the plan changed." })),
			plan: Type.Array(
				Type.Object({
					step: Type.String({ minLength: 1, description: "A concise task step." }),
					status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")]),
				}),
				{ description: "The complete replacement plan in execution order." },
			),
		}),
		async execute(_toolCallId, params) {
			const completed = params.plan.filter((step) => step.status === "completed").length;
			return {
				content: [{ type: "text", text: `Plan updated: ${completed}/${params.plan.length} completed.` }],
				details: undefined,
			};
		},
	});
}
