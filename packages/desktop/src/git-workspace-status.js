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

function emptyStatus(kind) {
	return {
		kind,
		branch: null,
		detached: false,
		dirty: false,
	};
}

export function parseGitStatusOutput(output) {
	let branch = null;
	let detached = false;
	let dirty = false;

	for (const line of String(output ?? "").split(/\r?\n/u)) {
		if (line.startsWith("# branch.head ")) {
			const head = line.slice("# branch.head ".length).trim();
			detached = head === "(detached)";
			branch = detached || !head ? null : head;
		} else if (line && !line.startsWith("# ")) {
			dirty = true;
		}
	}

	return {
		kind: "repository",
		branch,
		detached,
		dirty,
	};
}

function runGitStatus(cwd, execFileImpl, timeoutMs) {
	return new Promise((resolve) => {
		const complete = (error, stdout = "", stderr = "") => {
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

function isNotRepositoryFailure(error, stderr) {
	return Boolean(error) && /(?:^|\n)fatal: not a git repository(?:\s|:|$)/iu.test(stderr);
}

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
