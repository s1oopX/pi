import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const STORE_VERSION = 1;
const SSH_TOKEN = /^[^\s\u0000-\u001f\u007f]+$/u;
const SSH_ID = /^[a-z0-9._-]{1,128}$/u;

/**
 * @typedef {"none" | "identity"} SshAuth
 * @typedef {{
 *   id: string,
 *   name: string,
 *   alias: string,
 *   hostname: string,
 *   port?: number,
 *   auth: SshAuth,
 *   identityFile: string,
 *   remotePath: string,
 *   piCommand: string,
 *   autoConnect: boolean,
 * }} SshConnection
 */

/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("SSH connection must be an object");
	}
	return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {unknown} value
 * @param {string} label
 * @param {{ required?: boolean, max?: number }} [options]
 */
function text(value, label, { required = true, max = 4096 } = {}) {
	const result = typeof value === "string" ? value.trim() : "";
	if (required && !result) throw new Error(`${label} is required`);
	if (result.length > max) throw new Error(`${label} is too long`);
	if (/[\u0000-\u001f\u007f]/u.test(result)) throw new Error(`${label} contains control characters`);
	return result;
}

/** @param {unknown} value @param {string} label @param {boolean} required */
function sshToken(value, label, required) {
	const result = text(value, label, { required, max: 255 });
	if (result && (!SSH_TOKEN.test(result) || result.startsWith("-"))) {
		throw new Error(`${label} is not a valid SSH destination`);
	}
	return result;
}

/** @param {unknown} value @param {boolean} allowNewId */
function normalizeId(value, allowNewId) {
	const id = typeof value === "string" ? value.trim().toLowerCase() : "";
	if (!id && allowNewId) return randomUUID();
	if (!SSH_ID.test(id)) throw new Error("SSH connection id is invalid");
	return id;
}

/** @param {unknown} value */
function normalizePort(value) {
	if (value === undefined || value === null || value === "") return undefined;
	const port = Number(value);
	if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
		throw new Error("SSH port must be an integer from 1 to 65535");
	}
	return port;
}

/** @param {unknown} value @param {boolean} allowNewId @returns {SshConnection} */
function normalizeConnection(value, allowNewId) {
	const input = record(value);
	const auth = input.auth === undefined || input.auth === "none" ? "none" : input.auth;
	if (auth !== "none" && auth !== "identity") throw new Error("SSH auth must be none or identity");
	const identityFile = text(input.identityFile, "Identity file", { required: false });
	if (auth === "identity" && !identityFile) throw new Error("Identity file is required for identity auth");
	const remotePath = text(input.remotePath ?? "~", "Remote path");
	if (remotePath !== "~" && !remotePath.startsWith("~/") && !remotePath.startsWith("/")) {
		throw new Error("Remote path must be absolute or start with ~/");
	}
	const port = normalizePort(input.port);
	return {
		id: normalizeId(input.id, allowNewId),
		name: text(input.name, "Display name", { max: 100 }),
		alias: sshToken(input.alias, "Alias", false),
		hostname: sshToken(input.hostname, "Hostname", true),
		...(port === undefined ? {} : { port }),
		auth,
		identityFile,
		remotePath,
		piCommand: text(input.piCommand ?? "pi", "Pi command", { max: 1024 }),
		autoConnect: input.autoConnect === true,
	};
}

/** @param {unknown} value @returns {SshConnection} */
export function normalizeSshConnection(value) {
	return normalizeConnection(value, true);
}

/** @param {string} path @returns {SshConnection[]} */
export function loadSshConnections(path) {
	if (!existsSync(path)) return [];
	const stored = record(JSON.parse(readFileSync(path, "utf8")));
	if (!stored || stored.version !== STORE_VERSION || !Array.isArray(stored.connections)) {
		throw new Error("Unsupported SSH connections file");
	}
	const connections = /** @type {unknown[]} */ (stored.connections)
		.map((connection) => normalizeConnection(connection, false));
	if (new Set(connections.map(({ id }) => id)).size !== connections.length) {
		throw new Error("SSH connections file contains duplicate ids");
	}
	return connections;
}

/** @param {string} path @param {readonly SshConnection[]} connections */
export function saveSshConnections(path, connections) {
	const normalized = connections.map((connection) => normalizeConnection(connection, false));
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ version: STORE_VERSION, connections: normalized }, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	try {
		chmodSync(path, 0o600);
	} catch {
		// Windows does not implement POSIX file modes; the profile ACL still applies.
	}
}

/** @param {readonly SshConnection[]} connections @param {unknown} value */
export function upsertSshConnection(connections, value) {
	const connection = normalizeConnection(value, true);
	const next = connections
		.filter(({ id }) => id !== connection.id)
		.map((candidate) => connection.autoConnect ? { ...candidate, autoConnect: false } : candidate);
	next.push(connection);
	return { connections: next, connection };
}

/** @param {string} connectionId @param {string} remotePath */
export function createSshWorkspaceUri(connectionId, remotePath) {
	const id = normalizeId(connectionId, false);
	const path = text(remotePath, "Remote path");
	const suffix = path.startsWith("/") ? path : `/${path}`;
	return `ssh://${id}${suffix.split("/").map(encodeURIComponent).join("/")}`;
}

/** @param {unknown} value @returns {{ connectionId: string, remotePath: string } | null} */
export function parseSshWorkspaceUri(value) {
	if (typeof value !== "string" || !value.startsWith("ssh://")) return null;
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`Invalid SSH workspace URI: ${value}`);
	}
	if (url.protocol !== "ssh:" || url.username || url.password || url.port || url.search || url.hash) {
		throw new Error(`Invalid SSH workspace URI: ${value}`);
	}
	const decodedPath = url.pathname.split("/").map(decodeURIComponent).join("/");
	const remotePath = decodedPath === "/~" || decodedPath.startsWith("/~/") ? decodedPath.slice(1) : decodedPath;
	return {
		connectionId: normalizeId(url.hostname, false),
		remotePath: normalizeConnection({
			id: url.hostname,
			name: "workspace",
			hostname: "workspace",
			remotePath,
		}, false).remotePath,
	};
}

/**
 * @param {unknown} value
 * @param {readonly SshConnection[]} connections
 * @returns {{ connectionId: string, remotePath: string, connection: SshConnection } | null}
 */
export function resolveSshWorkspace(value, connections) {
	const workspace = parseSshWorkspaceUri(value);
	if (!workspace) return null;
	const connection = connections.find(({ id }) => id === workspace.connectionId);
	if (!connection) throw new Error(`SSH connection not found: ${workspace.connectionId}`);
	return { ...workspace, connection };
}

/** @param {unknown} value */
export function quotePosixShell(value) {
	return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

/** @param {string} value */
function remotePathExpression(value) {
	if (value === "~") return '"$HOME"';
	if (value.startsWith("~/")) return `"$HOME"/${quotePosixShell(value.slice(2))}`;
	return quotePosixShell(value);
}

/** @param {string} value */
function executableExpression(value) {
	return value.startsWith("~/") ? `"$HOME"/${quotePosixShell(value.slice(2))}` : quotePosixShell(value);
}

/** @param {string} value */
function localIdentityPath(value) {
	if (value === "~") return homedir();
	if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2));
	return value;
}

/** @param {SshConnection} connection @param {boolean} batchMode */
function sshArgs(connection, batchMode) {
	const args = [
		"-T",
		"-o",
		"StrictHostKeyChecking=accept-new",
		"-o",
		"ServerAliveInterval=30",
		"-o",
		"ServerAliveCountMax=3",
	];
	if (batchMode) args.push("-o", "BatchMode=yes", "-o", "ConnectTimeout=10");
	if (connection.port !== undefined) args.push("-p", String(connection.port));
	if (connection.auth === "identity") args.push("-i", localIdentityPath(connection.identityFile));
	args.push(connection.alias || connection.hostname);
	return args;
}

/**
 * @param {unknown} connectionValue
 * @param {string} remotePath
 * @param {Buffer | string} bridgeSource
 */
export function createSshLaunchSpec(connectionValue, remotePath, bridgeSource) {
	const connection = normalizeConnection(connectionValue, false);
	const prefix = Buffer.isBuffer(bridgeSource) ? bridgeSource : Buffer.from(String(bridgeSource), "utf8");
	if (prefix.length === 0) throw new Error("Remote bridge is empty");
	const bridgePath = '"$HOME/.pi/studio/remote-bridge.js"';
	const remoteCommand = [
		"umask 077",
		'mkdir -p "$HOME/.pi/studio"',
		`dd of=${bridgePath} bs=1 count=${prefix.length} 2>/dev/null`,
		`cd ${remotePathExpression(remotePath)}`,
		`exec ${executableExpression(connection.piCommand)} --mode rpc --no-extensions -e ${bridgePath}`,
	].join(" && ");
	return {
		command: "ssh",
		args: [...sshArgs(connection, false), remoteCommand],
		cwd: homedir(),
		checkExists: false,
		stdinPrefix: prefix,
	};
}

/** @param {unknown} connectionValue */
export function createSshTestSpec(connectionValue) {
	const connection = normalizeConnection(connectionValue, true);
	const remoteCommand = `cd ${remotePathExpression(connection.remotePath)} && exec ${executableExpression(connection.piCommand)} --version`;
	return {
		command: "ssh",
		args: [...sshArgs(connection, true), remoteCommand],
		cwd: homedir(),
	};
}

/**
 * @param {unknown} connectionValue
 * @param {string} remotePath
 * @param {readonly string[]} args
 */
export function createSshGitSpec(connectionValue, remotePath, args) {
	const connection = normalizeConnection(connectionValue, false);
	const gitArgs = args.map((arg) => {
		const value = String(arg);
		if (value.includes("\0")) throw new Error("Git arguments cannot contain NUL bytes");
		return quotePosixShell(value);
	});
	const remoteCommand = [
		`cd ${remotePathExpression(remotePath)}`,
		`GIT_OPTIONAL_LOCKS=0 LANG=C LC_ALL=C GIT_TERMINAL_PROMPT=0 exec git${gitArgs.length > 0 ? ` ${gitArgs.join(" ")}` : ""}`,
	].join(" && ");
	return {
		command: "ssh",
		args: [...sshArgs(connection, true), remoteCommand],
		cwd: homedir(),
	};
}
