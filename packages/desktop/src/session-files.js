import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

async function canonicalize(path, realpathImpl) {
	return realpathImpl(resolve(path));
}

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
