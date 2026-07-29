import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ImageContent, ImagesModel } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { generateImages as generateOpenRouterImages } from "../../ai/src/api/openrouter-images.ts";
import type { AuthStorage } from "../../coding-agent/src/core/auth-storage.ts";
import type { SettingsManager } from "../../coding-agent/src/core/settings-manager.ts";
import type { ExtensionAPI } from "../../coding-agent/src/index.ts";

const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 40 * 1024 * 1024;

const imageGenerationSchema = Type.Object({
	prompt: Type.String({ minLength: 1, maxLength: 20_000 }),
	references: Type.Optional(
		Type.Array(Type.String({ minLength: 1, maxLength: 2048 }), {
			maxItems: 5,
			description: "Optional workspace image paths to use as references.",
		}),
	),
	outputPath: Type.Optional(
		Type.String({
			minLength: 1,
			maxLength: 2048,
			description: "Optional output path inside the workspace. Existing files are never overwritten.",
		}),
	),
});

const MIME_BY_EXTENSION: Record<string, string> = {
	".gif": "image/gif",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp",
};
const SUPPORTED_IMAGE_MIME_TYPES = new Set(Object.values(MIME_BY_EXTENSION));

function isInside(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

async function workspaceRoots(cwd: string): Promise<{ absolute: string; real: string }> {
	const absolute = resolve(cwd);
	return { absolute, real: await realpath(absolute) };
}

async function resolveReference(cwd: string, input: string): Promise<{ path: string; content: ImageContent }> {
	const workspace = await workspaceRoots(cwd);
	const absolute = resolve(workspace.absolute, input);
	if (!isInside(workspace.absolute, absolute)) throw new Error(`Reference image is outside the workspace: ${input}`);
	const real = await realpath(absolute);
	if (!isInside(workspace.real, real)) throw new Error(`Reference image resolves outside the workspace: ${input}`);
	const info = await stat(real);
	if (!info.isFile()) throw new Error(`Reference image is not a file: ${input}`);
	if (info.size > MAX_REFERENCE_BYTES) throw new Error(`Reference image exceeds 20 MB: ${input}`);
	const extension = extname(real).toLowerCase();
	const mimeType = MIME_BY_EXTENSION[extension];
	if (!mimeType) throw new Error(`Unsupported reference image type: ${input}`);
	return {
		path: relative(workspace.absolute, absolute).split(sep).join("/"),
		content: { type: "image", mimeType, data: (await readFile(real)).toString("base64") },
	};
}

async function resolveOutputPath(cwd: string, input: string): Promise<{ absolute: string; relative: string }> {
	const workspace = await workspaceRoots(cwd);
	const absolute = resolve(workspace.absolute, input);
	if (!isInside(workspace.absolute, absolute) || basename(absolute) === "") {
		throw new Error(`Output path must be a file inside the workspace: ${input}`);
	}

	let existingParent = dirname(absolute);
	while (!existsSync(existingParent)) {
		const parent = dirname(existingParent);
		if (parent === existingParent) throw new Error(`Could not resolve output path: ${input}`);
		existingParent = parent;
	}
	if (!isInside(workspace.real, await realpath(existingParent))) {
		throw new Error(`Output path resolves outside the workspace: ${input}`);
	}
	return {
		absolute,
		relative: relative(workspace.absolute, absolute).split(sep).join("/"),
	};
}

function validateEndpoint(baseUrl: string): string {
	const parsed = new URL(baseUrl);
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("Image generation base URL must use HTTP or HTTPS");
	}
	if (parsed.username || parsed.password) throw new Error("Image generation base URL cannot contain credentials");
	return parsed.toString().replace(/\/$/, "");
}

export function imageGenerationExtension(
	pi: ExtensionAPI,
	settingsManager: SettingsManager,
	authStorage: AuthStorage,
): void {
	const settings = settingsManager.getImageGenerationSettings();
	if (!settings.enabled) return;

	pi.registerTool({
		name: "generate_image",
		label: "Generate Image",
		description:
			"Generate or edit an image through the configured image endpoint, save it inside the workspace, and return it.",
		promptSnippet: "Generate or edit images with the configured image model",
		promptGuidelines: [
			"Use generate_image only when the user explicitly wants an image created or edited.",
			"Reference images and output paths must stay inside the current workspace.",
		],
		parameters: imageGenerationSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const prompt = params.prompt.trim();
			if (!prompt) throw new Error("prompt is required");
			const output = await resolveOutputPath(
				ctx.cwd,
				params.outputPath?.trim() || `generated-images/${Date.now()}-${randomUUID().slice(0, 8)}.png`,
			);
			const references = await Promise.all((params.references ?? []).map((path) => resolveReference(ctx.cwd, path)));
			const credential = await authStorage.read(settings.provider);
			if (credential?.type !== "api_key" || !credential.key?.trim()) {
				throw new Error(`No API key is configured for image provider: ${settings.provider}`);
			}

			const model: ImagesModel<"openrouter-images"> = {
				id: settings.model,
				name: settings.model,
				api: "openrouter-images",
				provider: settings.provider,
				baseUrl: validateEndpoint(settings.baseUrl),
				input: ["text", "image"],
				output: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			};
			const response = await generateOpenRouterImages(
				model,
				{ input: [{ type: "text", text: prompt }, ...references.map((reference) => reference.content)] },
				{ apiKey: credential.key, signal },
			);
			if (response.stopReason !== "stop") {
				throw new Error(response.errorMessage || `Image generation ended with ${response.stopReason}`);
			}
			const image = response.output.find((item): item is ImageContent => item.type === "image");
			if (!image) throw new Error("Image endpoint returned no image");
			if (!SUPPORTED_IMAGE_MIME_TYPES.has(image.mimeType)) {
				throw new Error(`Unsupported generated image type: ${image.mimeType}`);
			}
			if (image.data.length > Math.ceil((MAX_OUTPUT_BYTES * 4) / 3) + 4) {
				throw new Error("Generated image exceeds 40 MB");
			}
			const bytes = Buffer.from(image.data, "base64");
			if (bytes.length === 0 || bytes.length > MAX_OUTPUT_BYTES)
				throw new Error("Generated image is invalid or too large");

			await mkdir(dirname(output.absolute), { recursive: true });
			const workspace = await workspaceRoots(ctx.cwd);
			if (!isInside(workspace.real, await realpath(dirname(output.absolute)))) {
				throw new Error(`Output path resolves outside the workspace: ${output.relative}`);
			}
			await writeFile(output.absolute, bytes, { flag: "wx" });
			const providerText = response.output
				.flatMap((item) => (item.type === "text" && item.text.trim() ? [item.text.trim()] : []))
				.join("\n");
			return {
				content: [
					{
						type: "text",
						text: `${providerText ? `${providerText}\n\n` : ""}Generated image saved to [${output.relative}](${output.relative}).`,
					},
					image,
				],
				details: {
					path: output.relative,
					mimeType: image.mimeType,
					provider: settings.provider,
					model: settings.model,
					references: references.map((reference) => reference.path),
				},
				usage: response.usage,
			};
		},
	});
}
