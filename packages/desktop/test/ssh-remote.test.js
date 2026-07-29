import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createSshCliSpec,
	createSshFileReadSpec,
	createSshGitSpec,
	createSshLaunchSpec,
	createSshTestSpec,
	createSshTrashSpec,
	createSshWorktreeDeleteSpec,
	createSshWorktreeListSpec,
	createSshWorktreeRemoveSpec,
	createSshWorktreeSpec,
	createSshWorkspaceUri,
	loadSshConnections,
	normalizeSshConnection,
	parseSshFileMetadata,
	parseSshWorktreeList,
	parseSshWorkspaceUri,
	quotePosixShell,
	saveSshConnections,
	upsertSshConnection,
} from "../src/ssh-remote.js";

const CONNECTION = {
	id: "11111111-1111-4111-8111-111111111111",
	name: "Dev box",
	alias: "devbox",
	hostname: "user@example.com",
	port: 2222,
	auth: "identity",
	identityFile: "~/.ssh/id_ed25519",
	remotePath: "~/work/pi",
	piCommand: "pi",
	autoConnect: true,
};

test("validates, persists, and updates SSH connections", (t) => {
	assert.throws(() => normalizeSshConnection({ ...CONNECTION, hostname: "-oProxyCommand=bad" }), /valid SSH destination/);
	assert.throws(() => normalizeSshConnection({ ...CONNECTION, remotePath: "relative/path" }), /absolute/);
	assert.throws(() => normalizeSshConnection({ ...CONNECTION, identityFile: "" }), /Identity file is required/);

	const directory = mkdtempSync(join(tmpdir(), "pi-studio-ssh-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const path = join(directory, "connections.json");
	const other = { ...CONNECTION, id: "22222222-2222-4222-8222-222222222222", name: "Other", autoConnect: true };
	const { connections } = upsertSshConnection([other], CONNECTION);
	assert.equal(connections[0].autoConnect, false);
	saveSshConnections(path, connections);
	assert.deepEqual(loadSshConnections(path), connections);
	assert.equal(JSON.parse(readFileSync(path, "utf8")).version, 1);
});

test("round-trips remote workspace URIs and POSIX shell quoting", () => {
	const uri = createSshWorkspaceUri(CONNECTION.id, "~/work/项目 folder");
	assert.deepEqual(parseSshWorkspaceUri(uri), {
		connectionId: CONNECTION.id,
		remotePath: "~/work/项目 folder",
	});
	assert.equal(quotePosixShell("a'b"), `'a'"'"'b'`);
});

test("builds non-interactive SSH test and stdin-prefixed RPC launch specs", () => {
	const bridge = Buffer.from("export default () => {};\n");
	const launch = createSshLaunchSpec(CONNECTION, "/srv/pi project", bridge);
	assert.equal(launch.command, "ssh");
	assert.equal(launch.checkExists, false);
	assert.equal(launch.stdinPrefix, bridge);
	assert.deepEqual(launch.args.slice(0, 3), ["-T", "-o", "StrictHostKeyChecking=accept-new"]);
	assert.ok(launch.args.includes("devbox"));
	assert.match(launch.args.at(-1), /dd .*count=25/u);
	assert.match(launch.args.at(-1), /remote-bridge\.\$\$\.tmp/u);
	assert.match(launch.args.at(-1), /mv -f -- "\$bridge_tmp" "\$HOME\/\.pi\/studio\/remote-bridge\.js"/u);
	assert.match(launch.args.at(-1), /cd '\/srv\/pi project'/u);
	assert.match(launch.args.at(-1), /--mode rpc --no-extensions -e/u);

	const probe = createSshTestSpec(CONNECTION);
	assert.ok(probe.args.includes("BatchMode=yes"));
	assert.match(probe.args.at(-1), /exec 'pi' --version/u);
});

test("builds a non-interactive, shell-quoted remote git spec", () => {
	const spec = createSshGitSpec(CONNECTION, "~/work/pi", ["commit", "-m", "fix 'quoted' $(nope)"]);
	assert.equal(spec.command, "ssh");
	assert.ok(spec.args.includes("BatchMode=yes"));
	assert.equal(
		spec.args.at(-1),
		`cd "$HOME"/'work/pi' && GIT_OPTIONAL_LOCKS=0 LANG=C LC_ALL=C GIT_TERMINAL_PROMPT=0 exec git 'commit' '-m' 'fix '"'"'quoted'"'"' $(nope)'`,
	);
	assert.throws(() => createSshGitSpec(CONNECTION, "/srv/pi", ["bad\0arg"]), /NUL/);
});

test("builds managed remote worktree create and clean-remove specs", () => {
	const created = createSshWorktreeSpec(CONNECTION, "/srv/pi project", "remote-a1b2c3d4e5f6");
	assert.equal(created.branch, "task/remote-a1b2c3d4e5f6");
	assert.equal(created.worktreePath, "~/.pi/studio/worktrees/remote-a1b2c3d4e5f6");
	assert.ok(created.args.includes("BatchMode=yes"));
	assert.match(created.args.at(-1), /cd '\/srv\/pi project'/u);
	assert.match(created.args.at(-1), /mkdir -p "\$worktree_root"/u);
	assert.match(created.args.at(-1), /git worktree prune/u);
	assert.match(created.args.at(-1), /git worktree add -b 'task\/remote-a1b2c3d4e5f6' "\$worktree_path"/u);
	assert.throws(() => createSshWorktreeSpec(CONNECTION, "/srv/pi", "../escape"), /invalid/iu);

	const removed = createSshWorktreeRemoveSpec(CONNECTION, "/srv/pi project", created.worktreePath);
	assert.match(
		removed.args.at(-1),
		/cd '\/srv\/pi project' && exec git worktree remove "\$HOME"\/'\.pi\/studio\/worktrees\/remote-a1b2c3d4e5f6'/u,
	);
	assert.doesNotMatch(removed.args.at(-1), /--force/u);
	assert.throws(
		() => createSshWorktreeRemoveSpec(CONNECTION, "/srv/pi", "~/other/worktree"),
		/managed folder/iu,
	);
});

test("lists and explicitly deletes retained remote worktrees", () => {
	const listed = createSshWorktreeListSpec(CONNECTION);
	assert.ok(listed.args.includes("BatchMode=yes"));
	assert.match(listed.args.at(-1), /worktree_root="\$HOME\/\.pi\/studio\/worktrees"/u);
	assert.match(listed.args.at(-1), /\[ ! -L "\$worktree_path" \]/u);
	assert.match(listed.args.at(-1), /PI_STUDIO_WORKTREE_V1/u);
	assert.deepEqual(
		parseSshWorktreeList([
			"Login banner",
			"PI_STUDIO_WORKTREE_V1\tremote-a1b2c3d4e5f6\t1\ttask/remote-a1b2c3d4e5f6",
			"PI_STUDIO_WORKTREE_V1\tremote-001122334455\t0\ttask/remote-001122334455",
			"PI_STUDIO_WORKTREE_V1\tremote-deadbeefcafe\t?\ttask/remote-deadbeefcafe",
		].join("\n")),
		[
			{
				worktreePath: "~/.pi/studio/worktrees/remote-a1b2c3d4e5f6",
				branch: "task/remote-a1b2c3d4e5f6",
				dirty: true,
			},
			{
				worktreePath: "~/.pi/studio/worktrees/remote-001122334455",
				branch: "task/remote-001122334455",
				dirty: false,
			},
			{
				worktreePath: "~/.pi/studio/worktrees/remote-deadbeefcafe",
				branch: "task/remote-deadbeefcafe",
				dirty: null,
			},
		],
	);
	assert.throws(
		() => parseSshWorktreeList("PI_STUDIO_WORKTREE_V1\tremote-a\t1\ttask/other"),
		/metadata/iu,
	);

	const deleted = createSshWorktreeDeleteSpec(
		CONNECTION,
		"~/.pi/studio/worktrees/remote-a1b2c3d4e5f6",
	);
	assert.match(deleted.args.at(-1), /symbolic-ref --quiet --short HEAD/u);
	assert.match(deleted.args.at(-1), /"\$branch" != 'task\/remote-a1b2c3d4e5f6'/u);
	assert.match(deleted.args.at(-1), /worktree list --porcelain/u);
	assert.match(deleted.args.at(-1), /git worktree remove --force "\$worktree_path"/u);
	assert.throws(() => createSshWorktreeDeleteSpec(CONNECTION, "~/work/pi"), /managed folder/iu);
});

test("builds remote gh and recoverable trash specs", () => {
	const gh = createSshCliSpec(CONNECTION, "/srv/pi project", "gh", ["pr", "view", "topic/it's"]);
	assert.match(gh.args.at(-1), /GH_PROMPT_DISABLED=1/u);
	assert.match(gh.args.at(-1), /exec gh 'pr' 'view' 'topic\/it'"'"'s'/u);

	const trash = createSshTrashSpec(CONNECTION, "~/work/pi", "src/it's $(unsafe).ts");
	assert.ok(trash.args.includes("BatchMode=yes"));
	assert.match(trash.trashPath, /^~\/\.pi\/studio\/trash\/\d+-[a-f0-9-]+-it's \$\(unsafe\)\.ts$/u);
	assert.match(trash.args.at(-1), /dirname '\.\/src\/it'"'"'s \$\(unsafe\)\.ts'/u);
	assert.match(trash.args.at(-1), /Remote trash path escaped the workspace/u);
	assert.match(trash.args.at(-1), /mv -- "\$target_directory\/\$target_name"/u);
	assert.throws(() => createSshTrashSpec(CONNECTION, "/srv/pi", "../secret"), /inside the workspace/);
	assert.throws(() => createSshTrashSpec(CONNECTION, "/srv/pi", "dir/../secret"), /inside the workspace/);
});

test("builds a descriptor-bound remote file stream and parses its metadata", () => {
	const spec = createSshFileReadSpec(CONNECTION, "/srv/pi project", "reports/it's $(unsafe).pdf", 4096);
	assert.ok(spec.args.includes("BatchMode=yes"));
	assert.equal(spec.relativePath, "reports/it's $(unsafe).pdf");
	assert.match(spec.args.at(-1), /exec 3<'\.\/reports\/it'"'"'s \$\(unsafe\)\.pdf'/u);
	assert.match(spec.args.at(-1), /readlink -f "\/proc\/\$\$\/fd\/3"/u);
	assert.match(spec.args.at(-1), /Remote artifact path escaped the workspace/u);
	assert.match(spec.args.at(-1), /PI_STUDIO_FILE_V1 %s %s/u);
	assert.match(spec.args.at(-1), /head -c 4097 <&3/u);
	assert.deepEqual(parseSshFileMetadata("Warning\nPI_STUDIO_FILE_V1 42 1700000000\n"), {
		size: 42,
		modifiedAt: 1_700_000_000_000,
	});
	assert.throws(() => createSshFileReadSpec(CONNECTION, "/srv/pi", "../secret", 10), /inside the workspace/);
	assert.throws(() => createSshFileReadSpec(CONNECTION, "/srv/pi", "/etc/passwd", 10), /inside the workspace/);
	assert.throws(() => createSshFileReadSpec(CONNECTION, "/srv/pi", "report.md", -1), /byte limit/);
	assert.throws(() => parseSshFileMetadata("missing"), /metadata/);
});
