import { constants } from "node:fs";
import { access, copyFile, open, realpath, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const MAX_IMPORT_BYTES = 256 * 1024 * 1024;
const FIRST_LINE_PROBE_BYTES = 64 * 1024;
const MAX_COLLISION_ATTEMPTS = 100;

/**
 * @param {string} path
 * @param {(path: string) => Promise<string>} realpathImpl
 */
async function canonicalize(path, realpathImpl) {
	return realpathImpl(resolve(path));
}

/**
 * @param {unknown} requestedPath
 * @param {Array<{path?: unknown, cwd?: unknown}> | unknown} sessions
 * @param {unknown} activeSessionPath
 */
export async function resolveKnownSessionFile(
	requestedPath,
	sessions,
	activeSessionPath,
	{ realpathImpl = realpath } = {},
) {
	if (typeof requestedPath !== "string" || !requestedPath.trim()) {
		throw new Error("Session path is required");
	}

	let requestedCanonicalPath;
	try {
		requestedCanonicalPath = await canonicalize(requestedPath, realpathImpl);
	} catch {
		throw new Error("Session file is unavailable");
	}

	let activeCanonicalPath;
	if (typeof activeSessionPath === "string" && activeSessionPath) {
		try {
			activeCanonicalPath = await canonicalize(activeSessionPath, realpathImpl);
		} catch {
			activeCanonicalPath = undefined;
		}
	}

	for (const session of Array.isArray(sessions) ? sessions : []) {
		if (!session || typeof session.path !== "string") continue;
		let knownCanonicalPath;
		try {
			knownCanonicalPath = await canonicalize(session.path, realpathImpl);
		} catch {
			continue;
		}
		if (knownCanonicalPath !== requestedCanonicalPath) continue;
		return {
			path: session.path,
			cwd: typeof session.cwd === "string" ? session.cwd : undefined,
			isActive: activeCanonicalPath === knownCanonicalPath,
		};
	}

	throw new Error("Session file is not available");
}

/** First line of the file must parse as a JSON object for it to be a session. */
/**
 * @param {string} sourcePath
 * @param {(path: string, flags: string) => Promise<import("node:fs/promises").FileHandle>} openImpl
 */
async function assertLooksLikeSessionJsonl(sourcePath, openImpl) {
	const handle = await openImpl(sourcePath, "r");
	let probe;
	try {
		const buffer = Buffer.alloc(FIRST_LINE_PROBE_BYTES);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		probe = buffer.toString("utf8", 0, bytesRead);
	} finally {
		await handle.close();
	}
	const newlineIndex = probe.indexOf("\n");
	const firstLine = (newlineIndex === -1 ? probe : probe.slice(0, newlineIndex)).trim();
	if (newlineIndex === -1 && probe.length >= FIRST_LINE_PROBE_BYTES) {
		throw new Error("Not a session JSONL file (first line is too long)");
	}
	let parsed;
	try {
		parsed = JSON.parse(firstLine);
	} catch {
		throw new Error("Not a session JSONL file (first line is not JSON)");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Not a session JSONL file (first line is not an object)");
	}
}

/**
 * Validate a picked JSONL file and copy it into the sessions directory under a
 * collision-free name. Returns the target path; never overwrites.
 */
/**
 * @param {unknown} sourcePath
 * @param {unknown} sessionsDir
 */
export async function prepareSessionImport(
	sourcePath,
	sessionsDir,
	{ accessImpl = access, copyFileImpl = copyFile, openImpl = open, statImpl = stat } = {},
) {
	if (typeof sourcePath !== "string" || !sourcePath.trim()) {
		throw new Error("A session file is required");
	}
	if (typeof sessionsDir !== "string" || !sessionsDir.trim()) {
		throw new Error("The sessions directory is unavailable");
	}

	const sourceStat = await statImpl(sourcePath);
	if (!sourceStat.isFile()) {
		throw new Error("Not a session JSONL file");
	}
	if (sourceStat.size === 0) {
		throw new Error("The session file is empty");
	}
	if (sourceStat.size > MAX_IMPORT_BYTES) {
		throw new Error("The session file is too large to import");
	}
	await assertLooksLikeSessionJsonl(sourcePath, openImpl);

	const name = basename(sourcePath);
	const stem = name.replace(/\.jsonl$/iu, "");
	for (let attempt = 0; attempt < MAX_COLLISION_ATTEMPTS; attempt++) {
		const candidateName = attempt === 0 ? `${stem}.jsonl` : `${stem}-imported-${attempt}.jsonl`;
		const targetPath = join(sessionsDir, candidateName);
		try {
			await accessImpl(targetPath);
			continue; // exists, try the next suffix
		} catch {
			// target free
		}
		// COPYFILE_EXCL turns a lost race into an error instead of an overwrite.
		await copyFileImpl(sourcePath, targetPath, constants.COPYFILE_EXCL);
		return targetPath;
	}
	throw new Error("Could not find a free name for the imported session");
}
