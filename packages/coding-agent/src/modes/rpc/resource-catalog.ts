import type { ResourceDiagnostic } from "../../core/diagnostics.ts";
import type { ExtensionError } from "../../core/extensions/types.ts";
import type { PromptTemplate } from "../../core/prompt-templates.ts";
import type { Skill } from "../../core/skills.ts";
import type { SourceInfo } from "../../core/source-info.ts";
import type { RpcGetResourcesDataDTO, RpcResourceKindDTO } from "./rpc-desktop-contract.ts";

interface ResourceExtension {
	path: string;
	resolvedPath: string;
	sourceInfo: SourceInfo;
}

export interface ResourceCatalogInput {
	extensions: readonly ResourceExtension[];
	extensionErrors: readonly Pick<ExtensionError, "extensionPath" | "error">[];
	extensionDiagnostics: readonly ResourceDiagnostic[];
	skills: readonly Pick<Skill, "name" | "description" | "filePath" | "sourceInfo">[];
	skillDiagnostics: readonly ResourceDiagnostic[];
	prompts: readonly Pick<PromptTemplate, "name" | "description" | "filePath" | "sourceInfo">[];
	promptDiagnostics: readonly ResourceDiagnostic[];
	extensionFlags?: readonly {
		name: string;
		type: "boolean" | "string";
		description?: string;
		default?: boolean | string;
		extensionPath: string;
	}[];
}

export async function loadResourceCatalog(
	readCatalogInput: () => ResourceCatalogInput,
	reloadResources?: () => Promise<void>,
): Promise<RpcGetResourcesDataDTO> {
	await reloadResources?.();
	return buildResourceCatalog(readCatalogInput());
}

function mapDiagnostics(
	resource: RpcResourceKindDTO,
	diagnostics: readonly ResourceDiagnostic[],
): RpcGetResourcesDataDTO["diagnostics"] {
	return diagnostics.map((diagnostic) => ({
		resource,
		type: diagnostic.type,
		message: diagnostic.message,
		path: diagnostic.path,
	}));
}

export function buildResourceCatalog(input: ResourceCatalogInput): RpcGetResourcesDataDTO {
	return {
		extensions: input.extensions.map((extension) => ({
			name: extension.path,
			path: extension.resolvedPath,
			sourceInfo: extension.sourceInfo,
		})),
		skills: input.skills.map((skill) => ({
			name: skill.name,
			description: skill.description,
			path: skill.filePath,
			sourceInfo: skill.sourceInfo,
		})),
		prompts: input.prompts.map((prompt) => ({
			name: prompt.name,
			description: prompt.description,
			path: prompt.filePath,
			sourceInfo: prompt.sourceInfo,
		})),
		diagnostics: [
			...input.extensionErrors.map((diagnostic) => ({
				resource: "extension" as const,
				type: "error" as const,
				message: diagnostic.error,
				path: diagnostic.extensionPath,
			})),
			...mapDiagnostics("extension", input.extensionDiagnostics),
			...mapDiagnostics("skill", input.skillDiagnostics),
			...mapDiagnostics("prompt", input.promptDiagnostics),
		],
		extensionFlags: (input.extensionFlags ?? []).map((flag) => ({
			name: flag.name,
			type: flag.type,
			description: flag.description,
			default: flag.default,
			extensionPath: flag.extensionPath,
		})),
	};
}
