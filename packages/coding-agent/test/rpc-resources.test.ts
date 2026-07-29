import { describe, expect, it, vi } from "vitest";
import type { SourceInfo } from "../src/core/source-info.ts";
import { buildResourceCatalog, loadResourceCatalog } from "../src/modes/rpc/resource-catalog.ts";
import { RpcClient } from "../src/modes/rpc/rpc-client.ts";

const sourceInfo: SourceInfo = {
	path: "/project/.pi/resources",
	source: "local",
	scope: "project",
	origin: "top-level",
};

describe("RPC resource catalog", () => {
	it("projects loaded resources and diagnostics into a read-only wire catalog", () => {
		const catalog = buildResourceCatalog({
			packages: [
				{
					source: "npm:@example/review-tools",
					scope: "user",
					filtered: false,
					installedPath: "/home/me/.pi/agent/npm/node_modules/@example/review-tools",
				},
			],
			extensions: [{ path: "review.ts", resolvedPath: "/project/.pi/extensions/review.ts", sourceInfo }],
			extensionErrors: [{ extensionPath: "/project/.pi/extensions/broken.ts", error: "Syntax error" }],
			extensionDiagnostics: [{ type: "collision", message: "Duplicate command", path: "/command" }],
			skills: [
				{
					name: "review",
					description: "Review changes",
					filePath: "/project/.pi/skills/review/SKILL.md",
					sourceInfo,
				},
			],
			skillDiagnostics: [{ type: "warning", message: "Missing optional metadata", path: "/skill" }],
			prompts: [
				{
					name: "fix",
					description: "Fix a problem",
					filePath: "/project/.pi/prompts/fix.md",
					sourceInfo,
				},
			],
			promptDiagnostics: [{ type: "collision", message: "Duplicate prompt", path: "/prompt" }],
		});

		expect(catalog.packages).toEqual([
			{
				source: "npm:@example/review-tools",
				scope: "user",
				filtered: false,
				installedPath: "/home/me/.pi/agent/npm/node_modules/@example/review-tools",
			},
		]);
		expect(catalog.extensions).toEqual([
			{
				name: "review.ts",
				path: "/project/.pi/extensions/review.ts",
				sourceInfo,
			},
		]);
		expect(catalog.skills[0]?.name).toBe("review");
		expect(catalog.prompts[0]?.name).toBe("fix");
		expect(catalog.extensionFlags).toEqual([]);
		expect(catalog.diagnostics).toEqual([
			{ resource: "extension", type: "error", message: "Syntax error", path: "/project/.pi/extensions/broken.ts" },
			{ resource: "extension", type: "collision", message: "Duplicate command", path: "/command" },
			{ resource: "skill", type: "warning", message: "Missing optional metadata", path: "/skill" },
			{ resource: "prompt", type: "collision", message: "Duplicate prompt", path: "/prompt" },
		]);
	});

	it("reloads resources before reading the latest catalog", async () => {
		let extensionName = "before.ts";
		const reload = vi.fn(async () => {
			extensionName = "after.ts";
		});

		const catalog = await loadResourceCatalog(
			() => ({
				extensions: [{ path: extensionName, resolvedPath: `/project/${extensionName}`, sourceInfo }],
				extensionErrors: [],
				extensionDiagnostics: [],
				skills: [],
				skillDiagnostics: [],
				prompts: [],
				promptDiagnostics: [],
			}),
			reload,
		);

		expect(reload).toHaveBeenCalledOnce();
		expect(catalog.extensions[0]?.name).toBe("after.ts");
	});

	it("includes registered extension flags in the catalog", () => {
		const catalog = buildResourceCatalog({
			extensions: [],
			extensionErrors: [],
			extensionDiagnostics: [],
			skills: [],
			skillDiagnostics: [],
			prompts: [],
			promptDiagnostics: [],
			extensionFlags: [
				{
					name: "permission-mode",
					type: "string",
					description: "Tool permission mode",
					default: "ask",
					extensionPath: "/home/me/.pi/agent/extensions/tool-approval.ts",
				},
			],
		});

		expect(catalog.extensionFlags).toEqual([
			{
				name: "permission-mode",
				type: "string",
				description: "Tool permission mode",
				default: "ask",
				extensionPath: "/home/me/.pi/agent/extensions/tool-approval.ts",
			},
		]);
	});
	it("exposes resource reload through RpcClient", async () => {
		const client = new RpcClient();
		const privateClient = client as unknown as {
			send: (command: { type: string; reload?: boolean }) => Promise<unknown>;
			getData: <T>(response: unknown) => T;
		};
		const data = { packages: [], extensions: [], skills: [], prompts: [], diagnostics: [], extensionFlags: [] };
		const send = vi.fn(async () => ({
			type: "response",
			command: "get_resources",
			success: true,
			data,
		}));
		privateClient.send = send;
		privateClient.getData = <T>(response: unknown): T => (response as { data: T }).data;

		await expect(client.getResources({ reload: true })).resolves.toEqual(data);
		expect(send).toHaveBeenCalledWith({ type: "get_resources", reload: true });
	});
});
