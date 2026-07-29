import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";
import { materializeSshArtifact, readSshArtifactPreview } from "../src/ssh-artifact.js";
import { MAX_WORKSPACE_FILE_PREVIEW_BYTES } from "../src/workspace-file-preview.js";

const REMOTE = {
	connection: {
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
	},
	remotePath: "~/work/pi",
};

function fakeExec(output, metadata, error = null) {
	const calls = [];
	const implementation = (file, args, options, callback) => {
		calls.push({ file, args, options });
		queueMicrotask(() => callback(error, output, Buffer.from(metadata)));
		return {};
	};
	return {
		calls,
		execFileImpl: /** @type {typeof execFile} */ (/** @type {unknown} */ (implementation)),
	};
}

function fakeSpawn(output, metadata) {
	const calls = [];
	const implementation = (file, args, options) => {
		calls.push({ file, args, options });
		const child = new EventEmitter();
		const stdout = new PassThrough();
		const stderr = new PassThrough();
		Object.assign(child, {
			stdout,
			stderr,
			kill: () => true,
		});
		queueMicrotask(() => {
			stderr.end(metadata);
			stdout.end(output);
			child.emit("close", 0, null);
		});
		return child;
	};
	return {
		calls,
		spawnImpl: /** @type {typeof spawn} */ (/** @type {unknown} */ (implementation)),
	};
}

describe("SSH artifact transfer", () => {
	it("previews bounded remote bytes and rejects incomplete transfers", async () => {
		const content = Buffer.from("# Remote\n");
		const metadata = `PI_STUDIO_FILE_V1 ${content.length} 1700000000\n`;
		const remoteExec = fakeExec(content, metadata);
		const preview = await readSshArtifactPreview(REMOTE, "reports/remote.md", {
			execFileImpl: remoteExec.execFileImpl,
		});
		assert.equal(preview.path, "reports/remote.md");
		assert.equal(preview.kind, "text");
		assert.equal(preview.mimeType, "text/markdown");
		assert.equal(preview.content, "# Remote\n");
		assert.equal(preview.modifiedAt, 1_700_000_000_000);
		assert.equal(remoteExec.calls[0].file, "ssh");
		assert.equal(remoteExec.calls[0].options.encoding, "buffer");
		const oversized = await readSshArtifactPreview(REMOTE, "reports/large.pdf", {
			execFileImpl: fakeExec(
				Buffer.alloc(0),
				`PI_STUDIO_FILE_V1 ${MAX_WORKSPACE_FILE_PREVIEW_BYTES + 1} 1700000000\n`,
			).execFileImpl,
		});
		assert.equal(oversized.kind, "too-large");

		await assert.rejects(
			readSshArtifactPreview(REMOTE, "reports/remote.md", {
				execFileImpl: fakeExec(Buffer.from("short"), metadata).execFileImpl,
			}),
			/incomplete/iu,
		);
	});

	it("materializes a content-addressed local cache file with a Windows-safe name", async (t) => {
		const root = await mkdtemp(join(tmpdir(), "pi-ssh-artifact-"));
		t.after(() => rm(root, { recursive: true, force: true }));
		const content = Buffer.from("remote pdf bytes");
		const metadata = `PI_STUDIO_FILE_V1 ${content.length} 1700000000\n`;
		const remoteSpawn = fakeSpawn(content, metadata);
		const path = await materializeSshArtifact(REMOTE, "reports/invoice:final?.pdf", join(root, "cache"), {
			spawnImpl: remoteSpawn.spawnImpl,
		});

		assert.deepEqual(await readFile(path), content);
		assert.match(basename(path), /^[a-f0-9]{64}-invoice_final_\.pdf$/u);
		assert.equal(remoteSpawn.calls[0].file, "ssh");
		assert.deepEqual(remoteSpawn.calls[0].options.stdio, ["ignore", "pipe", "pipe"]);
	});
});
