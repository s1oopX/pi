import { readFile, realpath, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { describeRevealTarget, resolveWorkspacePath } from "./path-reveal.js";
import { parseDelimitedSpreadsheet, parseXlsxSpreadsheet } from "./spreadsheet-preview.js";

export const MAX_WORKSPACE_FILE_PREVIEW_BYTES = 40 * 1024 * 1024;

const TEXT_MIME_TYPES = new Map([
	[".bat", "text/plain"],
	[".c", "text/plain"],
	[".cmd", "text/plain"],
	[".cpp", "text/plain"],
	[".css", "text/css"],
	[".go", "text/plain"],
	[".h", "text/plain"],
	[".hpp", "text/plain"],
	[".html", "text/html"],
	[".htm", "text/html"],
	[".ini", "text/plain"],
	[".java", "text/plain"],
	[".js", "text/javascript"],
	[".json", "application/json"],
	[".jsonl", "application/jsonl"],
	[".jsx", "text/javascript"],
	[".log", "text/plain"],
	[".md", "text/markdown"],
	[".mjs", "text/javascript"],
	[".ps1", "text/plain"],
	[".py", "text/plain"],
	[".rs", "text/plain"],
	[".sh", "text/plain"],
	[".sql", "text/plain"],
	[".svg", "image/svg+xml"],
	[".toml", "text/plain"],
	[".ts", "text/typescript"],
	[".tsx", "text/typescript"],
	[".txt", "text/plain"],
	[".vue", "text/plain"],
	[".xml", "application/xml"],
	[".yaml", "text/yaml"],
	[".yml", "text/yaml"],
]);

const BINARY_MIME_TYPES = new Map([
	[".avif", "image/avif"],
	[".bmp", "image/bmp"],
	[".gif", "image/gif"],
	[".ico", "image/x-icon"],
	[".jpeg", "image/jpeg"],
	[".jpg", "image/jpeg"],
	[".pdf", "application/pdf"],
	[".png", "image/png"],
	[".webp", "image/webp"],
]);

const SPREADSHEET_MIME_TYPES = new Map([
	[".csv", "text/csv"],
	[".tsv", "text/tab-separated-values"],
	[".xls", "application/vnd.ms-excel"],
	[".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
]);

/**
 * Build the renderer preview from trusted metadata and lazily supplied bytes.
 * Unsupported and oversized files never invoke the reader.
 * @param {string} path
 * @param {number} size
 * @param {number} modifiedAt
 * @param {() => Promise<Buffer>} readContent
 */
export async function buildWorkspaceFilePreview(path, size, modifiedAt, readContent) {
	if (!Number.isSafeInteger(size) || size < 0) throw new Error("File size is invalid");
	if (!Number.isFinite(modifiedAt)) throw new Error("File modified time is invalid");

	const extension = extname(path).toLocaleLowerCase("en");
	const textMimeType = TEXT_MIME_TYPES.get(extension)
		?? (/^(?:license|readme)(?:\.|$)/iu.test(basename(path)) ? "text/plain" : undefined);
	const binaryMimeType = BINARY_MIME_TYPES.get(extension);
	const spreadsheetMimeType = SPREADSHEET_MIME_TYPES.get(extension);
	const mimeType = textMimeType ?? binaryMimeType ?? spreadsheetMimeType ?? "application/octet-stream";
	const base = { path, size, modifiedAt, mimeType };

	if (size > MAX_WORKSPACE_FILE_PREVIEW_BYTES) return { ...base, kind: "too-large" };
	if (!textMimeType && !binaryMimeType && extension !== ".csv" && extension !== ".tsv" && extension !== ".xlsx") {
		return { ...base, kind: "unsupported" };
	}
	const content = await readContent();
	if (!Buffer.isBuffer(content)) throw new Error("File content is invalid");
	if (textMimeType === "image/svg+xml" || binaryMimeType?.startsWith("image/")) {
		return { ...base, kind: "image", dataBase64: content.toString("base64") };
	}
	if (binaryMimeType === "application/pdf") {
		return { ...base, kind: "pdf", dataBase64: content.toString("base64") };
	}
	if (extension === ".csv" || extension === ".tsv") {
		return {
			...base,
			kind: "spreadsheet",
			...parseDelimitedSpreadsheet(content.toString("utf8"), extension === ".csv" ? "," : "\t", basename(path, extension)),
		};
	}
	if (extension === ".xlsx") {
		return { ...base, kind: "spreadsheet", ...parseXlsxSpreadsheet(content) };
	}
	return {
		...base,
		kind: textMimeType === "text/html" ? "html" : "text",
		content: content.toString("utf8"),
	};
}

/**
 * Resolve an existing path twice: lexically first, then through symlinks.
 * Preview/open must not let a workspace symlink expose files elsewhere.
 * @param {string} workspaceCwd
 * @param {string} targetPath
 */
export async function resolveWorkspaceFilePath(workspaceCwd, targetPath) {
	const absolutePath = resolveWorkspacePath(workspaceCwd, targetPath);
	if (!describeRevealTarget(workspaceCwd, absolutePath).insideWorkspace) {
		throw new Error(`Path is outside the workspace: ${absolutePath}`);
	}
	const [realWorkspace, realPath] = await Promise.all([realpath(workspaceCwd), realpath(absolutePath)]);
	if (!describeRevealTarget(realWorkspace, realPath).insideWorkspace) {
		throw new Error(`Path is outside the workspace: ${absolutePath}`);
	}
	return { absolutePath, realPath };
}

/**
 * @param {string} workspaceCwd
 * @param {string} targetPath
 */
export async function readWorkspaceFilePreview(workspaceCwd, targetPath) {
	const { absolutePath, realPath } = await resolveWorkspaceFilePath(workspaceCwd, targetPath);
	const info = await stat(realPath);
	if (!info.isFile()) throw new Error(`Path is not a file: ${absolutePath}`);
	return buildWorkspaceFilePreview(absolutePath, info.size, info.mtimeMs, () => readFile(realPath));
}
