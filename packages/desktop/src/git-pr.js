/**
 * Pull-request creation for the workspace. Prefers the `gh` CLI (non-interactive,
 * no shell) and falls back to the GitHub compare page when gh is not installed.
 * Pure helpers are unit-tested without Electron.
 */

import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { describeGitFailure, resolveWorkspaceDir, runGit, validateBranchName } from "./git-commit.js";

const GIT_TIMEOUT_MS = 15000;
const GH_CREATE_TIMEOUT_MS = 30000;
const GH_PROBE_TIMEOUT_MS = 5000;
const MAX_PR_TITLE_LENGTH = 300;
const MAX_PR_BODY_LENGTH = 10000;

const REPO_SEGMENT_PATTERN = /^[A-Za-z0-9_.-]+$/u;

/**
 * Parse a git remote URL into { host, owner, repo }. Supports https, ssh://,
 * and scp-like git@host:owner/repo forms. Returns null for anything else
 * (local paths, unparseable URLs) so callers can degrade gracefully.
 */
export function parseGitRemoteUrl(url) {
	const raw = String(url ?? "").trim();
	if (!raw) return null;

	let host = "";
	let path = "";
	const httpsMatch = raw.match(/^https?:\/\/(?:[^/@]+@)?([^/:]+)(?::\d+)?\/(.+)$/u);
	const sshMatch = raw.match(/^ssh:\/\/(?:[^/@]+@)?([^/:]+)(?::\d+)?\/(.+)$/u);
	const scpMatch = raw.match(/^(?:[^@\s]+@)([^:/\s]+):(.+)$/u);
	if (httpsMatch) [, host, path] = httpsMatch;
	else if (sshMatch) [, host, path] = sshMatch;
	else if (scpMatch) [, host, path] = scpMatch;
	else return null;

	const segments = path
		.replace(/\.git$/u, "")
		.split("/")
		.filter(Boolean);
	if (segments.length < 2) return null;
	// Take the last two segments so GHE paths with a prefix still resolve.
	const owner = segments[segments.length - 2];
	const repo = segments[segments.length - 1];
	if (!REPO_SEGMENT_PATTERN.test(owner) || !REPO_SEGMENT_PATTERN.test(repo)) return null;
	return { host: host.toLowerCase(), owner, repo };
}

/** GitHub.com or a GitHub Enterprise style host ("github." as a component). */
export function isGitHubHost(host) {
	const normalized = String(host ?? "").toLowerCase();
	return normalized === "github.com" || /(^|\.)github\./u.test(normalized);
}

export function buildCompareUrl(remote, base, head) {
	if (!remote || !base || !head) return null;
	const range = `${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
	return `https://${remote.host}/${remote.owner}/${remote.repo}/compare/${range}?expand=1`;
}

export function validatePrTitle(title) {
	const trimmed = String(title ?? "").trim();
	if (!trimmed) return { ok: false, reason: "Pull request title is required" };
	if (trimmed.length > MAX_PR_TITLE_LENGTH) return { ok: false, reason: "Pull request title is too long" };
	return { ok: true, title: trimmed };
}

function runGh(cwd, args, execFileImpl, timeoutMs) {
	return new Promise((resolve) => {
		const complete = (error, stdout = "", stderr = "") => {
			resolve({ error, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
		};
		try {
			execFileImpl(
				"gh",
				args,
				{
					cwd,
					encoding: "utf8",
					env: {
						...process.env,
						GH_NO_UPDATE_NOTIFIER: "1",
						GH_PROMPT_DISABLED: "1",
						NO_COLOR: "1",
					},
					maxBuffer: 1024 * 1024,
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

function isMissingExecutable(result) {
	return result.error?.code === "ENOENT";
}

async function readBranch(cwd, execFileImpl, timeoutMs) {
	const result = await runGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"], execFileImpl, timeoutMs);
	const branch = result.error ? null : result.stdout.trim() || null;
	return { branch, detached: !branch };
}

async function readRemote(cwd, execFileImpl, timeoutMs) {
	const result = await runGit(cwd, ["remote", "get-url", "origin"], execFileImpl, timeoutMs);
	if (result.error) return null;
	return parseGitRemoteUrl(result.stdout.trim());
}

async function readBaseBranch(cwd, execFileImpl, timeoutMs) {
	// Prefer the remote's default branch; clones record it as origin/HEAD.
	const head = await runGit(
		cwd,
		["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
		execFileImpl,
		timeoutMs,
	);
	if (!head.error) {
		const name = head.stdout.trim().replace(/^origin\//u, "");
		if (name) return name;
	}
	for (const candidate of ["main", "master"]) {
		const probe = await runGit(cwd, ["rev-parse", "--verify", "--quiet", candidate], execFileImpl, timeoutMs);
		if (!probe.error && probe.stdout.trim()) return candidate;
	}
	return null;
}

async function readHasUpstream(cwd, execFileImpl, timeoutMs) {
	const result = await runGit(
		cwd,
		["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
		execFileImpl,
		timeoutMs,
	);
	return !result.error && result.stdout.trim().length > 0;
}

export async function getPullRequestContext(
	workspace,
	{ execFileImpl = execFile, realpathImpl = realpath, statImpl = stat, timeoutMs = GIT_TIMEOUT_MS } = {},
) {
	const cwd = await resolveWorkspaceDir(workspace, realpathImpl, statImpl);

	const { branch, detached } = await readBranch(cwd, execFileImpl, timeoutMs);
	const remote = await readRemote(cwd, execFileImpl, timeoutMs);
	const baseBranch = await readBaseBranch(cwd, execFileImpl, timeoutMs);
	const hasUpstream = branch ? await readHasUpstream(cwd, execFileImpl, timeoutMs) : false;

	const subjectResult = await runGit(cwd, ["log", "-1", "--format=%s"], execFileImpl, timeoutMs);
	const lastCommitSubject = subjectResult.error ? "" : subjectResult.stdout.split(/\r?\n/u)[0]?.trim() || "";

	const ghProbe = await runGh(cwd, ["--version"], execFileImpl, GH_PROBE_TIMEOUT_MS);
	const ghAvailable = !ghProbe.error;

	const isGitHub = Boolean(remote && isGitHubHost(remote.host));
	const compareUrl = isGitHub && branch && baseBranch && branch !== baseBranch
		? buildCompareUrl(remote, baseBranch, branch)
		: null;

	return { branch, detached, baseBranch, remote, isGitHub, compareUrl, lastCommitSubject, hasUpstream, ghAvailable };
}

/**
 * Create a pull request with gh; when gh is not installed, return the compare
 * URL instead so the caller can open it in a browser. Throws when the state
 * cannot produce a PR at all (detached, non-GitHub remote, unpushed branch).
 */
export async function createPullRequest(
	workspace,
	/** @type {{title?: string, body?: string, base?: string}} */ { title, body, base } = {},
	{ execFileImpl = execFile, realpathImpl = realpath, statImpl = stat, timeoutMs = GIT_TIMEOUT_MS } = {},
) {
	const validatedTitle = validatePrTitle(title);
	if (!validatedTitle.ok) throw new Error(validatedTitle.reason);
	const validatedBase = validateBranchName(base);
	if (!validatedBase.ok) throw new Error(`Base branch: ${validatedBase.reason}`);
	const trimmedBody = String(body ?? "").trim();
	if (trimmedBody.length > MAX_PR_BODY_LENGTH) throw new Error("Pull request body is too long");

	const cwd = await resolveWorkspaceDir(workspace, realpathImpl, statImpl);

	const { branch } = await readBranch(cwd, execFileImpl, timeoutMs);
	if (!branch) throw new Error("Cannot create a pull request from a detached HEAD");
	if (branch === validatedBase.name) throw new Error("Create a feature branch first; head and base are the same");

	const remote = await readRemote(cwd, execFileImpl, timeoutMs);
	if (!remote || !isGitHubHost(remote.host)) {
		throw new Error("Pull requests need a GitHub remote named origin");
	}

	if (!(await readHasUpstream(cwd, execFileImpl, timeoutMs))) {
		throw new Error("Push the branch before creating a pull request");
	}

	const repoSlug = `${remote.host}/${remote.owner}/${remote.repo}`;
	const ghArgs = [
		"pr",
		"create",
		"--repo",
		repoSlug,
		"--head",
		branch,
		"--base",
		validatedBase.name,
		"--title",
		validatedTitle.title,
		"--body",
		trimmedBody,
	];
	const result = await runGh(cwd, ghArgs, execFileImpl, GH_CREATE_TIMEOUT_MS);

	if (isMissingExecutable(result)) {
		const url = buildCompareUrl(remote, validatedBase.name, branch);
		return { created: false, method: "compare", url };
	}
	if (result.error) {
		// gh mentions the existing PR's URL when one is already open for the branch.
		const existing = `${result.stderr}\n${result.stdout}`.match(/https?:\/\/\S+/u)?.[0];
		if (existing && /already exists/iu.test(result.stderr)) {
			throw new Error(`A pull request for ${branch} already exists: ${existing}`);
		}
		throw describeGitFailure("Could not create the pull request", result);
	}

	const url = result.stdout
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter((line) => /^https?:\/\/\S+$/u.test(line))
		.pop();
	if (!url) throw new Error("gh did not report a pull request URL");
	return { created: true, method: "gh", url };
}
