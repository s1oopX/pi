import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join, posix } from "node:path";
import { pipeline } from "node:stream/promises";
import { createSshFileReadSpec, parseSshFileMetadata } from "./ssh-remote.js";
import { buildWorkspaceFilePreview, MAX_WORKSPACE_FILE_PREVIEW_BYTES } from "./workspace-file-preview.js";

const PREVIEW_TIMEOUT_MS = 2 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const SSH_STDERR_LIMIT_BYTES = 128 * 1024;
export const MAX_REMOTE_ARTIFACT_DOWNLOAD_BYTES = 512 * 1024 * 1024;

/**
 * @typedef {{
 *   connection: Parameters<typeof createSshFileReadSpec>[0],
 *   remotePath: string,
 * }} SshArtifactWorkspace
 */

/** @param {unknown} stderr */
function cleanSshError(stderr) {
	return (Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr ?? ""))
		.replace(/^PI_STUDIO_FILE_V1 [0-9]+ -?[0-9]+\r?$/gmu, "")
		.trim();
}

/** @param {string} action @param {unknown} error @param {unknown} stderr */
function sshFileFailure(action, error, stderr) {
	const detail = (cleanSshError(stderr) || (error instanceof Error ? error.message : String(error ?? "unknown error")))
		.slice(0, 500);
	return new Error(`${action}: ${detail}`);
}

/** @param {{ size: number }} metadata @param {number} bytes @param {number} maxBytes */
function assertRemoteFileLength(metadata, bytes, maxBytes) {
	const expected = metadata.size <= maxBytes ? metadata.size : 0;
	if (bytes !== expected) throw new Error("Remote file changed or the transfer was incomplete");
}

/**
 * @param {SshArtifactWorkspace} remote
 * @param {unknown} filePath
 * @param {{ execFileImpl?: typeof execFile, timeoutMs?: number }} [options]
 */
export function readSshArtifactPreview(
	remote,
	filePath,
	{ execFileImpl = execFile, timeoutMs = PREVIEW_TIMEOUT_MS } = {},
) {
	const spec = createSshFileReadSpec(
		remote.connection,
		remote.remotePath,
		filePath,
		MAX_WORKSPACE_FILE_PREVIEW_BYTES,
	);
	return new Promise((resolve, reject) => {
		execFileImpl(
			spec.command,
			spec.args,
			{
				cwd: spec.cwd,
				encoding: "buffer",
				maxBuffer: MAX_WORKSPACE_FILE_PREVIEW_BYTES + 64 * 1024,
				shell: false,
				timeout: timeoutMs,
				windowsHide: true,
			},
			(error, stdout, stderr) => {
				if (error) {
					reject(sshFileFailure("Could not read the remote artifact", error, stderr));
					return;
				}
				let metadata;
				try {
					metadata = parseSshFileMetadata(stderr);
					assertRemoteFileLength(metadata, stdout.length, MAX_WORKSPACE_FILE_PREVIEW_BYTES);
				} catch (readError) {
					reject(readError);
					return;
				}
				buildWorkspaceFilePreview(
					spec.relativePath,
					metadata.size,
					metadata.modifiedAt,
					async () => stdout,
				).then(resolve, reject);
			},
		);
	});
}

/** @param {string} relativePath */
function safeCacheName(relativePath) {
	const sanitized = posix.basename(relativePath)
		.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_")
		.slice(0, 80)
		.replace(/[. ]+$/u, "");
	return sanitized || "artifact";
}

/**
 * @param {SshArtifactWorkspace} remote
 * @param {unknown} filePath
 * @param {string} cacheDirectory
 * @param {{ spawnImpl?: typeof spawn, timeoutMs?: number }} [options]
 */
export async function materializeSshArtifact(
	remote,
	filePath,
	cacheDirectory,
	{ spawnImpl = spawn, timeoutMs = DOWNLOAD_TIMEOUT_MS } = {},
) {
	const spec = createSshFileReadSpec(
		remote.connection,
		remote.remotePath,
		filePath,
		MAX_REMOTE_ARTIFACT_DOWNLOAD_BYTES,
	);
	await mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
	const temporaryPath = join(cacheDirectory, `.download-${randomUUID()}`);
	const child = spawnImpl(spec.command, spec.args, {
		cwd: spec.cwd,
		shell: false,
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
	if (!child.stdout || !child.stderr) throw new Error("Could not open the remote artifact stream");

	let stderr = "";
	let bytes = 0;
	let timedOut = false;
	const contentHash = createHash("sha256");
	child.stderr.on("data", (/** @type {Buffer} */ chunk) => {
		stderr = `${stderr}${chunk.toString("utf8")}`.slice(-SSH_STDERR_LIMIT_BYTES);
	});
	child.stdout.on("data", (/** @type {Buffer} */ chunk) => {
		bytes += chunk.length;
		contentHash.update(chunk);
	});

	const exit = new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code, signal) => {
			if (timedOut) {
				reject(new Error("Remote artifact download timed out"));
				return;
			}
			if (code === 0) resolve(undefined);
			else reject(sshFileFailure("Could not download the remote artifact", new Error(`ssh exited code=${code} signal=${signal}`), stderr));
		});
	});
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill();
	}, timeoutMs);
	timer.unref?.();

	try {
		await Promise.all([
			pipeline(child.stdout, createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 })),
			exit,
		]);
		const metadata = parseSshFileMetadata(stderr);
		assertRemoteFileLength(metadata, bytes, MAX_REMOTE_ARTIFACT_DOWNLOAD_BYTES);
		if (metadata.size > MAX_REMOTE_ARTIFACT_DOWNLOAD_BYTES) {
			throw new Error("Remote artifact exceeds the 512 MB download limit");
		}

		const finalPath = join(cacheDirectory, `${contentHash.digest("hex")}-${safeCacheName(spec.relativePath)}`);
		try {
			const cached = await stat(finalPath);
			if (!cached.isFile() || cached.size !== metadata.size) throw new Error("Remote artifact cache entry is invalid");
			await rm(temporaryPath, { force: true });
			return finalPath;
		} catch (cacheError) {
			const code = cacheError && typeof cacheError === "object"
				? /** @type {{ code?: unknown }} */ (cacheError).code
				: undefined;
			if (code !== "ENOENT") throw cacheError;
		}

		try {
			await rename(temporaryPath, finalPath);
		} catch (renameError) {
			const cached = await stat(finalPath).catch(() => undefined);
			if (!cached?.isFile() || cached.size !== metadata.size) throw renameError;
			await rm(temporaryPath, { force: true });
		}
		return finalPath;
	} catch (error) {
		child.kill();
		await rm(temporaryPath, { force: true }).catch(() => {});
		throw error;
	} finally {
		clearTimeout(timer);
	}
}
