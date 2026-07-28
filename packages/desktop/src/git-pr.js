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
const GH_READ_TIMEOUT_MS = 30000;
const MAX_PR_TITLE_LENGTH = 300;
const MAX_PR_BODY_LENGTH = 10000;
const MAX_PR_FEEDBACK_BODY_LENGTH = 4000;
const MAX_PR_FEEDBACK_ITEMS = 100;
const MAX_PR_THREAD_ID_LENGTH = 256;

const REPO_SEGMENT_PATTERN = /^[A-Za-z0-9_.-]+$/u;
const REVIEW_THREADS_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
	repository(owner: $owner, name: $repo) {
		pullRequest(number: $number) {
			reviewThreads(first: 100) {
				pageInfo { hasNextPage }
				nodes {
					id
					isResolved
					isOutdated
					path
					line
					originalLine
					diffSide
					viewerCanReply
					viewerCanResolve
					viewerCanUnresolve
					comments(first: 100) {
						pageInfo { hasNextPage }
						nodes { fullDatabaseId author { login } body createdAt url state }
					}
				}
			}
		}
	}
}`;
const REPLY_TO_REVIEW_THREAD_MUTATION = `mutation($threadId: ID!, $body: String!) {
	addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
		comment { url }
	}
}`;
const RESOLVE_REVIEW_THREAD_MUTATION = `mutation($threadId: ID!) {
	resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } }
}`;
const UNRESOLVE_REVIEW_THREAD_MUTATION = `mutation($threadId: ID!) {
	unresolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } }
}`;

/** @typedef {"comment" | "review" | "inline"} PullRequestFeedbackKind */
/**
 * @typedef {{
 *   kind: PullRequestFeedbackKind,
 *   id: string,
 *   author: string,
 *   body: string,
 *   createdAt: string,
 *   url: string,
 *   state?: string,
 *   path?: string,
 *   line?: number,
 *   side?: string,
 *   threadId?: string,
 *   resolved?: boolean,
 *   outdated?: boolean,
 *   canReply?: boolean,
 *   canResolve?: boolean,
 *   canUnresolve?: boolean,
 * }} PullRequestFeedback
 */

/**
 * Parse a git remote URL into { host, owner, repo }. Supports https, ssh://,
 * and scp-like git@host:owner/repo forms. Returns null for anything else
 * (local paths, unparseable URLs) so callers can degrade gracefully.
 */
/** @param {unknown} url */
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
/** @param {unknown} host */
export function isGitHubHost(host) {
	const normalized = String(host ?? "").toLowerCase();
	return normalized === "github.com" || /(^|\.)github\./u.test(normalized);
}

/**
 * @param {{ host: string, owner: string, repo: string } | null} remote
 * @param {string | null | undefined} base
 * @param {string | null | undefined} head
 */
export function buildCompareUrl(remote, base, head) {
	if (!remote || !base || !head) return null;
	const range = `${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
	return `https://${remote.host}/${remote.owner}/${remote.repo}/compare/${range}?expand=1`;
}

/**
 * @param {unknown} title
 * @returns {{ ok: false, reason: string } | { ok: true, title: string }}
 */
export function validatePrTitle(title) {
	const trimmed = String(title ?? "").trim();
	if (!trimmed) return { ok: false, reason: "Pull request title is required" };
	if (trimmed.length > MAX_PR_TITLE_LENGTH) return { ok: false, reason: "Pull request title is too long" };
	return { ok: true, title: trimmed };
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {import("node:child_process").execFile} execFileImpl
 * @param {number} timeoutMs
 * @returns {Promise<{ error: unknown, stdout: string, stderr: string }>}
 */
function runGh(cwd, args, execFileImpl, timeoutMs) {
	return new Promise((resolve) => {
		const complete = (/** @type {unknown} */ error, stdout = "", stderr = "") => {
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

/** @param {{ error: unknown }} result */
function isMissingExecutable(result) {
	return Boolean(
		result.error &&
			typeof result.error === "object" &&
			/** @type {{ code?: unknown }} */ (result.error).code === "ENOENT",
	);
}

/** @param {unknown} value @returns {Record<string, unknown> | undefined} */
function asRecord(value) {
	return value && typeof value === "object" && !Array.isArray(value)
		? /** @type {Record<string, unknown>} */ (value)
		: undefined;
}

/** @param {unknown} value */
function normalizeFeedbackBody(value) {
	const raw = typeof value === "string" ? value.trim() : "";
	if (!raw) return "";
	return raw.length <= MAX_PR_FEEDBACK_BODY_LENGTH
		? raw
		: `${raw.slice(0, MAX_PR_FEEDBACK_BODY_LENGTH)}…`;
}

/**
 * @param {PullRequestFeedback[]} feedback
 * @param {unknown} value
 * @param {"comment" | "review"} kind
 * @param {string} pullRequestUrl
 */
function appendFeedback(feedback, value, kind, pullRequestUrl) {
	const item = asRecord(value);
	if (!item) return;
	const body = normalizeFeedbackBody(item.body);
	if (!body) return;
	const author = asRecord(item.author);
	const rawId = item.id;
	const createdAtKey = kind === "review" ? "submittedAt" : "createdAt";
	feedback.push({
		kind,
		id: typeof rawId === "string" || typeof rawId === "number" ? String(rawId) : `${kind}-${feedback.length}`,
		author: typeof author?.login === "string" ? author.login : "unknown",
		body,
		createdAt: typeof item[createdAtKey] === "string" ? item[createdAtKey] : "",
		url: typeof item.url === "string" ? item.url : pullRequestUrl,
		...(typeof item.state === "string" && item.state ? { state: item.state } : {}),
	});
}

/**
 * @param {PullRequestFeedback[]} feedback
 * @param {unknown} value
 * @param {string} pullRequestUrl
 */
function appendReviewThreads(feedback, value, pullRequestUrl) {
	const root = asRecord(value);
	let partial = Array.isArray(root?.errors) && root.errors.length > 0;
	const data = asRecord(root?.data);
	const repository = asRecord(data?.repository);
	const pullRequest = asRecord(repository?.pullRequest);
	const threads = asRecord(pullRequest?.reviewThreads);
	if (!threads || !Array.isArray(threads.nodes)) return true;
	partial ||= asRecord(threads.pageInfo)?.hasNextPage === true;

	for (const threadValue of threads.nodes) {
		const thread = asRecord(threadValue);
		const comments = asRecord(thread?.comments);
		if (!thread || !comments || !Array.isArray(comments.nodes)) {
			partial = true;
			continue;
		}
		partial ||= asRecord(comments.pageInfo)?.hasNextPage === true;
		for (let index = 0; index < comments.nodes.length; index += 1) {
			const item = asRecord(comments.nodes[index]);
			if (!item) continue;
			const body = normalizeFeedbackBody(item.body);
			if (!body) continue;
			const author = asRecord(item.author);
			const rawId = item.fullDatabaseId;
			const rawLine = thread.line ?? thread.originalLine;
			const line = typeof rawLine === "number" && Number.isSafeInteger(rawLine) && rawLine > 0
				? rawLine
				: undefined;
			const isLastComment = index === comments.nodes.length - 1;
			feedback.push({
				kind: "inline",
				id: typeof rawId === "string" || typeof rawId === "number"
					? String(rawId)
					: `inline-${feedback.length}`,
				author: typeof author?.login === "string" ? author.login : "unknown",
				body,
				createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
				url: typeof item.url === "string" ? item.url : pullRequestUrl,
				...(typeof item.state === "string" && item.state ? { state: item.state } : {}),
				...(typeof thread.path === "string" && thread.path ? { path: thread.path } : {}),
				...(line ? { line } : {}),
				...(typeof thread.diffSide === "string" && thread.diffSide ? { side: thread.diffSide } : {}),
				...(isLastComment && typeof thread.id === "string" && thread.id ? { threadId: thread.id } : {}),
				...(isLastComment && typeof thread.isResolved === "boolean" ? { resolved: thread.isResolved } : {}),
				...(isLastComment && typeof thread.isOutdated === "boolean" ? { outdated: thread.isOutdated } : {}),
				...(isLastComment && typeof thread.viewerCanReply === "boolean" ? { canReply: thread.viewerCanReply } : {}),
				...(isLastComment && typeof thread.viewerCanResolve === "boolean"
					? { canResolve: thread.viewerCanResolve }
					: {}),
				...(isLastComment && typeof thread.viewerCanUnresolve === "boolean"
					? { canUnresolve: thread.viewerCanUnresolve }
					: {}),
			});
		}
	}
	return partial;
}

/**
 * @param {string} cwd
 * @param {import("node:child_process").execFile} execFileImpl
 * @param {number} timeoutMs
 */
async function readBranch(cwd, execFileImpl, timeoutMs) {
	const result = await runGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"], execFileImpl, timeoutMs);
	const branch = result.error ? null : result.stdout.trim() || null;
	return { branch, detached: !branch };
}

/**
 * @param {string} cwd
 * @param {import("node:child_process").execFile} execFileImpl
 * @param {number} timeoutMs
 */
async function readRemote(cwd, execFileImpl, timeoutMs) {
	const result = await runGit(cwd, ["remote", "get-url", "origin"], execFileImpl, timeoutMs);
	if (result.error) return null;
	return parseGitRemoteUrl(result.stdout.trim());
}

/**
 * @param {string} cwd
 * @param {import("node:child_process").execFile} execFileImpl
 * @param {number} timeoutMs
 */
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

/**
 * @param {string} cwd
 * @param {import("node:child_process").execFile} execFileImpl
 * @param {number} timeoutMs
 */
async function readHasUpstream(cwd, execFileImpl, timeoutMs) {
	const result = await runGit(
		cwd,
		["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
		execFileImpl,
		timeoutMs,
	);
	return !result.error && result.stdout.trim().length > 0;
}

/** @param {string} workspace */
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
 * @param {string} cwd
 * @param {import("node:child_process").execFile} execFileImpl
 * @param {number} timeoutMs
 * @param {string[]} fields
 */
async function readCurrentPullRequest(cwd, execFileImpl, timeoutMs, fields) {
	const { branch } = await readBranch(cwd, execFileImpl, timeoutMs);
	if (!branch) throw new Error("Check out a branch before accessing its pull request");
	const remote = await readRemote(cwd, execFileImpl, timeoutMs);
	if (!remote || !isGitHubHost(remote.host)) throw new Error("Pull request access needs a GitHub remote named origin");

	const repoSlug = `${remote.host}/${remote.owner}/${remote.repo}`;
	const view = await runGh(
		cwd,
		["pr", "view", branch, "--repo", repoSlug, "--json", fields.join(",")],
		execFileImpl,
		GH_READ_TIMEOUT_MS,
	);
	if (isMissingExecutable(view)) throw new Error("GitHub CLI (gh) is required for pull request access");
	if (view.error) throw describeGitFailure("Could not load the current branch's pull request", view);

	let parsed;
	try {
		parsed = JSON.parse(view.stdout);
	} catch {
		throw new Error("gh returned invalid pull request data");
	}
	const pullRequest = asRecord(parsed);
	if (!pullRequest) throw new Error("gh returned incomplete pull request data");
	return { remote, repoSlug, pullRequest };
}

/** @param {string} workspace */
export async function getPullRequestReview(
	workspace,
	{ execFileImpl = execFile, realpathImpl = realpath, statImpl = stat, timeoutMs = GIT_TIMEOUT_MS } = {},
) {
	const cwd = await resolveWorkspaceDir(workspace, realpathImpl, statImpl);
	const { remote, pullRequest } = await readCurrentPullRequest(
		cwd,
		execFileImpl,
		timeoutMs,
		["number", "title", "url", "state", "reviewDecision", "comments", "reviews"],
	);
	const number = pullRequest.number;
	const title = pullRequest.title;
	const url = pullRequest.url;
	if (
		typeof number !== "number" ||
		!Number.isSafeInteger(number) ||
		number <= 0 ||
		typeof title !== "string" ||
		typeof url !== "string"
	) {
		throw new Error("gh returned incomplete pull request data");
	}

	/** @type {PullRequestFeedback[]} */
	const feedback = [];
	for (const comment of Array.isArray(pullRequest.comments) ? pullRequest.comments : []) {
		appendFeedback(feedback, comment, "comment", url);
	}
	for (const review of Array.isArray(pullRequest.reviews) ? pullRequest.reviews : []) {
		appendFeedback(feedback, review, "review", url);
	}

	let partial = false;
	const inline = await runGh(
		cwd,
		[
			"api",
			"graphql",
			"--hostname",
			remote.host,
			"-F",
			`owner=${remote.owner}`,
			"-F",
			`repo=${remote.repo}`,
			"-F",
			`number=${number}`,
			"-f",
			`query=${REVIEW_THREADS_QUERY}`,
		],
		execFileImpl,
		GH_READ_TIMEOUT_MS,
	);
	if (inline.error) {
		partial = true;
	} else {
		try {
			partial = appendReviewThreads(feedback, JSON.parse(inline.stdout), url);
		} catch {
			partial = true;
		}
	}

	feedback.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
	const reviewDecision = pullRequest.reviewDecision;
	return {
		number,
		title,
		url,
		state: typeof pullRequest.state === "string" ? pullRequest.state : "UNKNOWN",
		...(typeof reviewDecision === "string" && reviewDecision ? { reviewDecision } : {}),
		feedback: feedback.slice(-MAX_PR_FEEDBACK_ITEMS),
		partial,
	};
}

/**
 * @param {string} workspace
 * @param {unknown} params
 */
export async function updatePullRequestReview(
	workspace,
	params,
	{ execFileImpl = execFile, realpathImpl = realpath, statImpl = stat, timeoutMs = GIT_TIMEOUT_MS } = {},
) {
	const action = asRecord(params);
	if (!action) throw new Error("Unknown pull request review action");
	const type = action.type;
	if (type !== "comment" && type !== "reply" && type !== "resolve") {
		throw new Error("Unknown pull request review action");
	}

	const body = type === "comment" || type === "reply" ? String(action.body ?? "").trim() : "";
	if ((type === "comment" || type === "reply") && !body) throw new Error("Pull request comment is required");
	if (body.length > MAX_PR_BODY_LENGTH) throw new Error("Pull request comment is too long");

	const threadId = type === "reply" || type === "resolve" ? String(action.threadId ?? "").trim() : "";
	if ((type === "reply" || type === "resolve") && !threadId) throw new Error("Pull request review thread is required");
	if (threadId.length > MAX_PR_THREAD_ID_LENGTH) throw new Error("Pull request review thread is invalid");
	if (type === "resolve" && typeof action.resolved !== "boolean") {
		throw new Error("Pull request review thread state is required");
	}

	const cwd = await resolveWorkspaceDir(workspace, realpathImpl, statImpl);
	const { remote, repoSlug, pullRequest } = await readCurrentPullRequest(
		cwd,
		execFileImpl,
		timeoutMs,
		["number"],
	);
	const number = pullRequest.number;
	if (typeof number !== "number" || !Number.isSafeInteger(number) || number <= 0) {
		throw new Error("gh returned incomplete pull request data");
	}

	/** @type {string[]} */
	let args;
	let description = "";
	if (type === "comment") {
		args = ["pr", "comment", String(number), "--repo", repoSlug, "--body", body];
		description = "Could not post the pull request comment";
	} else if (type === "reply") {
		args = [
			"api",
			"graphql",
			"--hostname",
			remote.host,
			"-f",
			`query=${REPLY_TO_REVIEW_THREAD_MUTATION}`,
			"-f",
			`threadId=${threadId}`,
			"-f",
			`body=${body}`,
		];
		description = "Could not reply to the pull request review thread";
	} else {
		args = [
			"api",
			"graphql",
			"--hostname",
			remote.host,
			"-f",
			`query=${action.resolved ? RESOLVE_REVIEW_THREAD_MUTATION : UNRESOLVE_REVIEW_THREAD_MUTATION}`,
			"-f",
			`threadId=${threadId}`,
		];
		description = action.resolved
			? "Could not resolve the pull request review thread"
			: "Could not reopen the pull request review thread";
	}

	const result = await runGh(cwd, args, execFileImpl, GH_CREATE_TIMEOUT_MS);
	if (isMissingExecutable(result)) throw new Error("GitHub CLI (gh) is required for pull request actions");
	if (result.error) throw describeGitFailure(description, result);
	return { updated: true };
}

/**
 * Create a pull request with gh; when gh is not installed, return the compare
 * URL instead so the caller can open it in a browser. Throws when the state
 * cannot produce a PR at all (detached, non-GitHub remote, unpushed branch).
 */
/** @param {string} workspace */
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
