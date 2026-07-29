import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createSshLaunchSpec,
	createSshTestSpec,
	createSshWorkspaceUri,
	loadSshConnections,
	normalizeSshConnection,
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
	assert.match(launch.args.at(-1), /cd '\/srv\/pi project'/u);
	assert.match(launch.args.at(-1), /--mode rpc --no-extensions -e/u);

	const probe = createSshTestSpec(CONNECTION);
	assert.ok(probe.args.includes("BatchMode=yes"));
	assert.match(probe.args.at(-1), /exec 'pi' --version/u);
});
