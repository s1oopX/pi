import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildCompareUrl,
	createPullRequest,
	getPullRequestContext,
	getPullRequestReview,
	isGitHubHost,
	parseGitRemoteUrl,
	updatePullRequestReview,
	validatePrTitle,
} from "../src/git-pr.js";

const fsOk = {
	realpathImpl: async (path) => path,
	statImpl: async () => ({ isDirectory: () => true }),
};

function fakeExec(responses) {
	const calls = [];
	const execFileImpl = (cmd, args, _options, callback) => {
		calls.push({ cmd, args });
		const response = responses.shift() ?? { stdout: "" };
		callback(response.error ?? null, response.stdout ?? "", response.stderr ?? "");
	};
	return { calls, execFileImpl };
}

describe("parseGitRemoteUrl", () => {
	it("parses https remotes with and without .git", () => {
		assert.deepEqual(parseGitRemoteUrl("https://github.com/s1oopX/pi.git"), {
			host: "github.com",
			owner: "s1oopX",
			repo: "pi",
		});
		assert.deepEqual(parseGitRemoteUrl("https://github.com/owner/repo"), {
			host: "github.com",
			owner: "owner",
			repo: "repo",
		});
	});

	it("parses scp-like and ssh remotes, including ports", () => {
		assert.deepEqual(parseGitRemoteUrl("git@github.com:owner/repo.git"), {
			host: "github.com",
			owner: "owner",
			repo: "repo",
		});
		assert.deepEqual(parseGitRemoteUrl("ssh://git@github.com:22/owner/repo.git"), {
			host: "github.com",
			owner: "owner",
			repo: "repo",
		});
	});

	it("takes the last two path segments for prefixed GHE paths", () => {
		assert.deepEqual(parseGitRemoteUrl("https://github.corp.example/scm/team/repo.git"), {
			host: "github.corp.example",
			owner: "team",
			repo: "repo",
		});
	});

	it("rejects local paths and malformed values", () => {
		assert.equal(parseGitRemoteUrl("C:\\repos\\remote.git"), null);
		assert.equal(parseGitRemoteUrl("/srv/git/remote.git"), null);
		assert.equal(parseGitRemoteUrl("https://github.com/only-owner"), null);
		assert.equal(parseGitRemoteUrl(""), null);
	});
});

describe("isGitHubHost", () => {
	it("accepts github.com and github.* enterprise hosts only", () => {
		assert.equal(isGitHubHost("github.com"), true);
		assert.equal(isGitHubHost("GitHub.com"), true);
		assert.equal(isGitHubHost("github.corp.example"), true);
		assert.equal(isGitHubHost("corp.github.example"), true);
		assert.equal(isGitHubHost("gitlab.com"), false);
		assert.equal(isGitHubHost("mygithub.dev"), false);
	});
});

describe("buildCompareUrl", () => {
	it("encodes branch names with slashes", () => {
		const remote = { host: "github.com", owner: "o", repo: "r" };
		assert.equal(
			buildCompareUrl(remote, "main", "feature/e2e"),
			"https://github.com/o/r/compare/main...feature%2Fe2e?expand=1",
		);
	});

	it("returns null when any part is missing", () => {
		assert.equal(buildCompareUrl(null, "main", "x"), null);
		assert.equal(buildCompareUrl({ host: "h", owner: "o", repo: "r" }, "", "x"), null);
	});
});

describe("validatePrTitle", () => {
	it("requires a non-empty title and caps its length", () => {
		assert.equal(validatePrTitle("  ").ok, false);
		assert.deepEqual(validatePrTitle("  fix: thing  "), { ok: true, title: "fix: thing" });
		assert.equal(validatePrTitle("x".repeat(301)).ok, false);
	});
});

describe("getPullRequestContext", () => {
	it("assembles branch, remote, base, upstream, subject, and gh availability", async () => {
		const exec = fakeExec([
			{ stdout: "feature/x\n" }, // symbolic-ref HEAD
			{ stdout: "https://github.com/o/r.git\n" }, // remote get-url origin
			{ stdout: "origin/main\n" }, // symbolic-ref origin/HEAD
			{ stdout: "origin/feature/x\n" }, // rev-parse @{upstream}
			{ stdout: "fix: last subject\n" }, // log -1 %s
			{ stdout: "gh version 2.0.0\n" }, // gh --version
		]);
		const context = await getPullRequestContext("C:\\work", { ...fsOk, execFileImpl: exec.execFileImpl });
		assert.equal(context.branch, "feature/x");
		assert.equal(context.detached, false);
		assert.equal(context.baseBranch, "main");
		assert.deepEqual(context.remote, { host: "github.com", owner: "o", repo: "r" });
		assert.equal(context.isGitHub, true);
		assert.equal(context.compareUrl, "https://github.com/o/r/compare/main...feature%2Fx?expand=1");
		assert.equal(context.lastCommitSubject, "fix: last subject");
		assert.equal(context.hasUpstream, true);
		assert.equal(context.ghAvailable, true);
		assert.equal(exec.calls.at(-1).cmd, "gh");
	});

	it("falls back to main/master probing when origin/HEAD is unset", async () => {
		const exec = fakeExec([
			{ stdout: "feature/x\n" },
			{ stdout: "git@github.com:o/r.git\n" },
			{ error: new Error("no origin/HEAD") }, // symbolic-ref origin/HEAD
			{ error: new Error("no main") }, // rev-parse main
			{ stdout: "abc123\n" }, // rev-parse master
			{ stdout: "origin/feature/x\n" },
			{ stdout: "subject\n" },
			{ error: Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }) },
		]);
		const context = await getPullRequestContext("C:\\work", { ...fsOk, execFileImpl: exec.execFileImpl });
		assert.equal(context.baseBranch, "master");
		assert.equal(context.ghAvailable, false);
	});

	it("marks a detached HEAD and a non-GitHub remote", async () => {
		const exec = fakeExec([
			{ error: new Error("not symbolic") }, // symbolic-ref HEAD
			{ stdout: "C:\\repos\\remote.git\n" }, // remote get-url origin
			{ error: new Error("no origin/HEAD") },
			{ error: new Error("no main") },
			{ error: new Error("no master") },
			{ stdout: "subject\n" },
			{ stdout: "gh version 2.0.0\n" },
		]);
		const context = await getPullRequestContext("C:\\work", { ...fsOk, execFileImpl: exec.execFileImpl });
		assert.equal(context.branch, null);
		assert.equal(context.detached, true);
		assert.equal(context.remote, null);
		assert.equal(context.isGitHub, false);
		assert.equal(context.compareUrl, null);
		assert.equal(context.hasUpstream, false);
	});
});

describe("getPullRequestReview", () => {
	it("loads general, review, and inline feedback for the current branch", async () => {
		const exec = fakeExec([
			{ stdout: "feature/x\n" },
			{ stdout: "https://github.com/o/r.git\n" },
			{
				stdout: JSON.stringify({
					number: 7,
					title: "Improve retries",
					url: "https://github.com/o/r/pull/7",
					state: "OPEN",
					reviewDecision: "CHANGES_REQUESTED",
					comments: [{
						id: "comment-1",
						author: { login: "alice" },
						body: "Please add a regression test.",
						createdAt: "2026-07-29T02:00:00Z",
						url: "https://github.com/o/r/pull/7#issuecomment-1",
					}],
					reviews: [{
						id: "review-1",
						author: { login: "bob" },
						body: "The fallback needs work.",
						submittedAt: "2026-07-29T01:00:00Z",
						state: "CHANGES_REQUESTED",
					}],
				}),
			},
			{
				stdout: JSON.stringify({
					data: {
						repository: {
							pullRequest: {
								reviewThreads: {
									pageInfo: { hasNextPage: false },
									nodes: [{
										id: "PRRT_test",
										isResolved: false,
										isOutdated: true,
										path: "src/retry.ts",
										line: null,
										originalLine: 42,
										diffSide: "RIGHT",
										viewerCanReply: true,
										viewerCanResolve: true,
										viewerCanUnresolve: false,
										comments: {
											pageInfo: { hasNextPage: false },
											nodes: [{
												fullDatabaseId: "99",
												author: { login: "carol" },
												body: "Cover this retry branch.",
												createdAt: "2026-07-29T03:00:00Z",
												url: "https://github.com/o/r/pull/7#discussion_r99",
												state: "SUBMITTED",
											}],
										},
									}],
								},
							},
						},
					},
				}),
			},
		]);

		const review = await getPullRequestReview("C:\\work", { ...fsOk, execFileImpl: exec.execFileImpl });
		assert.equal(review.number, 7);
		assert.equal(review.reviewDecision, "CHANGES_REQUESTED");
		assert.equal(review.partial, false);
		assert.deepEqual(review.feedback.map((item) => item.kind), ["review", "comment", "inline"]);
		assert.deepEqual(review.feedback.at(-1), {
			kind: "inline",
			id: "99",
			author: "carol",
			body: "Cover this retry branch.",
			createdAt: "2026-07-29T03:00:00Z",
			url: "https://github.com/o/r/pull/7#discussion_r99",
			path: "src/retry.ts",
			line: 42,
			side: "RIGHT",
			state: "SUBMITTED",
			threadId: "PRRT_test",
			resolved: false,
			outdated: true,
			canReply: true,
			canResolve: true,
			canUnresolve: false,
		});
		const inlineArgs = exec.calls.at(-1).args;
		assert.deepEqual(inlineArgs.slice(0, 4), ["api", "graphql", "--hostname", "github.com"]);
		assert.ok(inlineArgs.includes("owner=o"));
		assert.ok(inlineArgs.includes("repo=r"));
		assert.ok(inlineArgs.includes("number=7"));
		assert.ok(inlineArgs.some((arg) => arg.includes("reviewThreads(first: 100)")));
	});

	it("reports when the current branch has no pull request", async () => {
		const exec = fakeExec([
			{ stdout: "feature/x\n" },
			{ stdout: "https://github.com/o/r.git\n" },
			{ error: new Error("exit 1"), stderr: "no pull requests found for branch feature/x" },
		]);
		await assert.rejects(
			getPullRequestReview("C:\\work", { ...fsOk, execFileImpl: exec.execFileImpl }),
			/no pull requests found/iu,
		);
	});
});

describe("updatePullRequestReview", () => {
	function actionResponses() {
		return [
			{ stdout: "feature/x\n" },
			{ stdout: "https://github.com/o/r.git\n" },
			{ stdout: JSON.stringify({ number: 7 }) },
			{ stdout: "{}" },
		];
	}

	it("posts comments, replies to threads, and toggles thread resolution through gh", async () => {
		const commentExec = fakeExec(actionResponses());
		await updatePullRequestReview(
			"C:\\work",
			{ type: "comment", body: "Ship it." },
			{ ...fsOk, execFileImpl: commentExec.execFileImpl },
		);
		assert.deepEqual(commentExec.calls.at(-1).args, [
			"pr",
			"comment",
			"7",
			"--repo",
			"github.com/o/r",
			"--body",
			"Ship it.",
		]);

		const replyExec = fakeExec(actionResponses());
		await updatePullRequestReview(
			"C:\\work",
			{ type: "reply", threadId: "PRRT_test", body: "Fixed." },
			{ ...fsOk, execFileImpl: replyExec.execFileImpl },
		);
		const replyArgs = replyExec.calls.at(-1).args;
		assert.deepEqual(replyArgs.slice(0, 4), ["api", "graphql", "--hostname", "github.com"]);
		assert.ok(replyArgs.includes("threadId=PRRT_test"));
		assert.ok(replyArgs.includes("body=Fixed."));
		assert.ok(replyArgs.some((arg) => arg.includes("addPullRequestReviewThreadReply")));

		for (const resolved of [true, false]) {
			const resolveExec = fakeExec(actionResponses());
			await updatePullRequestReview(
				"C:\\work",
				{ type: "resolve", threadId: "PRRT_test", resolved },
				{ ...fsOk, execFileImpl: resolveExec.execFileImpl },
			);
			assert.ok(resolveExec.calls.at(-1).args.some((arg) =>
				arg.includes(resolved ? "resolveReviewThread" : "unresolveReviewThread")));
		}
	});

	it("validates review actions before touching the workspace", async () => {
		const exec = fakeExec([]);
		await assert.rejects(
			updatePullRequestReview("C:\\work", { type: "comment", body: " " }, { ...fsOk, execFileImpl: exec.execFileImpl }),
			/comment is required/,
		);
		await assert.rejects(
			updatePullRequestReview(
				"C:\\work",
				{ type: "reply", threadId: "", body: "x" },
				{ ...fsOk, execFileImpl: exec.execFileImpl },
			),
			/thread is required/,
		);
		await assert.rejects(
			updatePullRequestReview(
				"C:\\work",
				{ type: "resolve", threadId: "PRRT_test" },
				{ ...fsOk, execFileImpl: exec.execFileImpl },
			),
			/thread state is required/,
		);
		assert.equal(exec.calls.length, 0);
	});
});

describe("createPullRequest", () => {
	function happyPathResponses(ghResponse) {
		return [
			{ stdout: "feature/x\n" }, // symbolic-ref HEAD
			{ stdout: "https://github.com/o/r.git\n" }, // remote get-url origin
			{ stdout: "origin/feature/x\n" }, // rev-parse @{upstream}
			ghResponse,
		];
	}

	it("invokes gh with explicit repo, head, base, title, and body", async () => {
		const exec = fakeExec(happyPathResponses({ stdout: "https://github.com/o/r/pull/7\n" }));
		const result = await createPullRequest(
			"C:\\work",
			{ title: "feat: thing", body: "Details", base: "main" },
			{ ...fsOk, execFileImpl: exec.execFileImpl },
		);
		assert.deepEqual(result, { created: true, method: "gh", url: "https://github.com/o/r/pull/7" });
		const ghCall = exec.calls.at(-1);
		assert.equal(ghCall.cmd, "gh");
		assert.deepEqual(ghCall.args, [
			"pr",
			"create",
			"--repo",
			"github.com/o/r",
			"--head",
			"feature/x",
			"--base",
			"main",
			"--title",
			"feat: thing",
			"--body",
			"Details",
		]);
	});

	it("returns the compare URL when gh is not installed", async () => {
		const exec = fakeExec(
			happyPathResponses({ error: Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }) }),
		);
		const result = await createPullRequest(
			"C:\\work",
			{ title: "feat: thing", body: "", base: "main" },
			{ ...fsOk, execFileImpl: exec.execFileImpl },
		);
		assert.deepEqual(result, {
			created: false,
			method: "compare",
			url: "https://github.com/o/r/compare/main...feature%2Fx?expand=1",
		});
	});

	it("surfaces the existing PR URL when one is already open", async () => {
		const exec = fakeExec(
			happyPathResponses({
				error: new Error("exit 1"),
				stderr: "a pull request for branch \"feature/x\" already exists:\nhttps://github.com/o/r/pull/3",
			}),
		);
		await assert.rejects(
			createPullRequest(
				"C:\\work",
				{ title: "feat: thing", body: "", base: "main" },
				{ ...fsOk, execFileImpl: exec.execFileImpl },
			),
			/already exists.*pull\/3/su,
		);
	});

	it("requires a pushed branch, a GitHub remote, and distinct head/base", async () => {
		const noUpstream = fakeExec([
			{ stdout: "feature/x\n" },
			{ stdout: "https://github.com/o/r.git\n" },
			{ error: new Error("no upstream") },
		]);
		await assert.rejects(
			createPullRequest(
				"C:\\work",
				{ title: "t", body: "", base: "main" },
				{ ...fsOk, execFileImpl: noUpstream.execFileImpl },
			),
			/Push the branch/,
		);

		const nonGitHub = fakeExec([{ stdout: "feature/x\n" }, { stdout: "https://gitlab.com/o/r.git\n" }]);
		await assert.rejects(
			createPullRequest(
				"C:\\work",
				{ title: "t", body: "", base: "main" },
				{ ...fsOk, execFileImpl: nonGitHub.execFileImpl },
			),
			/GitHub remote/,
		);

		const onBase = fakeExec([{ stdout: "main\n" }]);
		await assert.rejects(
			createPullRequest("C:\\work", { title: "t", body: "", base: "main" }, { ...fsOk, execFileImpl: onBase.execFileImpl }),
			/head and base are the same/,
		);
	});

	it("validates title, base, and body before touching git", async () => {
		const exec = fakeExec([]);
		await assert.rejects(
			createPullRequest("C:\\work", { title: " ", body: "", base: "main" }, { ...fsOk, execFileImpl: exec.execFileImpl }),
			/title is required/,
		);
		await assert.rejects(
			createPullRequest(
				"C:\\work",
				{ title: "t", body: "", base: "-bad" },
				{ ...fsOk, execFileImpl: exec.execFileImpl },
			),
			/Base branch/,
		);
		await assert.rejects(
			createPullRequest(
				"C:\\work",
				{ title: "t", body: "x".repeat(10001), base: "main" },
				{ ...fsOk, execFileImpl: exec.execFileImpl },
			),
			/body is too long/,
		);
		assert.equal(exec.calls.length, 0);
	});
});
