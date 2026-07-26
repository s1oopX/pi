import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";

const GIT_STATUS_TIMEOUT_MS = 2000;
const GIT_STATUS_MAX_BUFFER_BYTES = 256 * 1024;
const GIT_STATUS_ARGS = [
	"-c",
	"color.status=false",
	"status",
	"--porcelain=v2",
	"--branch",
	"--untracked-files=normal",
];

/** @param {"repository" | "not-repository" | "unavailable"} kind */
function emptyStatus(kind) {
	return {
		kind,
		branch: null,
		detached: false,
		dirty: false,
		upstream: null,
		ahead: 0,
		behind: 0,
	};
}

/** @param {string} output */
export function parseGitStatusOutput(output) {
	let branch = null;
	let detached = false;
	let dirty = false;
	let upstream = null;
	let ahead = 0;
	let behind = 0;

	for (const line of String(output ?? "").split(/\r?\n/u)) {
		if (line.startsWith("# branch.head ")) {
			const head = line.slice("# branch.head ".length).trim();
			detached = head === "(detached)";
			branch = detached || !head ? null : head;
		} else if (line.startsWith("# branch.upstream ")) {
			const value = line.slice("# branch.upstream ".length).trim();
			upstream = value || null;
		} else if (line.startsWith("# branch.ab ")) {
			// Format: "+<ahead> -<behind>"
			const match = /\+(\d+)\s+-(\d+)/u.exec(line.slice("# branch.ab ".length));
			if (match) {
				ahead = Number(match[1]);
				behind = Number(match[2]);
			}
		} else if (line && !line.startsWith("# ")) {
			dirty = true;
		}
	}

	return {
		kind: "repository",
		branch,
		detached,
		dirty,
		upstream,
		ahead,
		behind,
	};
}

/**
 * @param {string} cwd
 * @param {import("node:child_process").execFile} execFileImpl
 * @param {number} timeoutMs
 * @returns {Promise<{error: unknown, stdout: string, stderr: string}>}
 */
function runGitStatus(cwd, execFileImpl, timeoutMs) {
	return new Promise((resolve) => {
		const complete = (/** @type {unknown} */ error, stdout = "", stderr = "") => {
			resolve({
				error,
				stdout: String(stdout ?? ""),
				stderr: String(stderr ?? ""),
			});
		};

		try {
			execFileImpl(
				"git",
				GIT_STATUS_ARGS,
				{
					cwd,
					encoding: "utf8",
					env: {
						...process.env,
						GIT_OPTIONAL_LOCKS: "0",
						LANG: "C",
						LC_ALL: "C",
					},
					maxBuffer: GIT_STATUS_MAX_BUFFER_BYTES,
					shell: false,
					timeout: timeoutMs,
					windowsHide: true,
				},
				complete,
			);
		} catch (error) {
			complete(error);
		}
	});
}

/**
 * @param {unknown} error
 * @param {string} stderr
 */
function isNotRepositoryFailure(error, stderr) {
	return Boolean(error) && /(?:^|\n)fatal: not a git repository(?:\s|:|$)/iu.test(stderr);
}

/** @param {string} workspace */
export async function getGitWorkspaceStatus(
	workspace,
	{
		execFileImpl = execFile,
		realpathImpl = realpath,
		statImpl = stat,
		timeoutMs = GIT_STATUS_TIMEOUT_MS,
	} = {},
) {
	let cwd;
	try {
		if (typeof workspace !== "string" || !workspace.trim()) return emptyStatus("unavailable");
		cwd = await realpathImpl(workspace);
		if (!(await statImpl(cwd)).isDirectory()) return emptyStatus("unavailable");
	} catch {
		return emptyStatus("unavailable");
	}

	const result = await runGitStatus(cwd, execFileImpl, timeoutMs);
	if (result.error) {
		return isNotRepositoryFailure(result.error, result.stderr)
			? emptyStatus("not-repository")
			: emptyStatus("unavailable");
	}
	return parseGitStatusOutput(result.stdout);
}
