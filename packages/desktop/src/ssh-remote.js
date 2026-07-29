import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix } from "node:path";

const STORE_VERSION = 1;
const SSH_TOKEN = /^[^\s\u0000-\u001f\u007f]+$/u;
const SSH_ID = /^[a-z0-9._-]{1,128}$/u;
const SSH_WORKTREE_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const SSH_FILE_METADATA_PREFIX = "PI_STUDIO_FILE_V1";
const SSH_WORKTREE_METADATA_PREFIX = "PI_STUDIO_WORKTREE_V1";
const SSH_MANAGED_PI_COMMAND = "~/.pi/studio/bin/pi";
const SSH_NODE_VERSION = "22.19.0";
const SSH_NODE_SHA256 = {
	arm64: {
		gzip: "d32817b937219b8f131a28546035183d79e7fd17a86e38ccb8772901a7cd9009",
		xz: "0b2d9f564b6594222a62c82e1df2efe119dd4a4aff29644f4dd325bf360b6bcc",
	},
	x64: {
		gzip: "d36e56998220085782c0ca965f9d51b7726335aed2f5fc7321c6c0ad233aa96d",
		xz: "c0649af18e6a24f6fe5535a3e86b341dd49a8e71117c8b68bde973ef834f16f2",
	},
};

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

/** @param {unknown} value */
function normalizeSshWorktreeName(value) {
	const name = text(value, "Remote worktree name", { max: 64 }).toLowerCase();
	if (!SSH_WORKTREE_NAME.test(name) || name.includes("..") || name.endsWith(".") || name.endsWith(".lock")) {
		throw new Error("Remote worktree name is invalid");
	}
	return name;
}

/** @param {unknown} value */
function normalizePiVersion(value) {
	const version = text(value, "Pi version", { max: 32 });
	if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error("Pi version is invalid");
	return version;
}

/** @param {unknown} value */
function normalizeManagedSshWorktreePath(value) {
	const worktreePath = text(value, "Remote worktree path");
	const prefix = "~/.pi/studio/worktrees/";
	const rawName = worktreePath.startsWith(prefix) ? worktreePath.slice(prefix.length) : "";
	const name = rawName ? normalizeSshWorktreeName(rawName) : "";
	if (!name || rawName !== name || worktreePath !== `${prefix}${name}`) {
		throw new Error("Remote worktree path is outside Pi Studio's managed folder");
	}
	return { name, worktreePath };
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
		'bridge_tmp="$HOME/.pi/studio/remote-bridge.$$.tmp"',
		`dd of="$bridge_tmp" bs=1 count=${prefix.length} 2>/dev/null`,
		`mv -f -- "$bridge_tmp" ${bridgePath}`,
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
 * Install a matching Pi CLI without sudo. A checksum-pinned Node runtime and
 * exact npm package version live under ~/.pi/studio; npm lifecycle scripts are
 * disabled, and the stable wrapper keeps later SSH launches independent of the
 * remote host's PATH.
 * @param {unknown} connectionValue
 * @param {unknown} piVersionValue
 */
export function createSshPiInstallSpec(connectionValue, piVersionValue) {
	const connection = normalizeConnection(connectionValue, false);
	const piVersion = normalizePiVersion(piVersionValue);
	const packageSpec = `@earendil-works/pi-coding-agent@${piVersion}`;
	const remoteCommand = [
		"set -eu",
		"umask 077",
		"export LANG=C LC_ALL=C",
		'if [ "$(uname -s)" != "Linux" ]; then echo "Automatic Pi installation currently supports Linux SSH hosts" >&2; exit 69; fi',
		'case "$(uname -m)" in',
		`x86_64|amd64) node_arch=x64; node_sha_xz=${quotePosixShell(SSH_NODE_SHA256.x64.xz)}; node_sha_gzip=${quotePosixShell(SSH_NODE_SHA256.x64.gzip)} ;;`,
		`aarch64|arm64) node_arch=arm64; node_sha_xz=${quotePosixShell(SSH_NODE_SHA256.arm64.xz)}; node_sha_gzip=${quotePosixShell(SSH_NODE_SHA256.arm64.gzip)} ;;`,
		'*) echo "Automatic Pi installation supports Linux x64 and arm64 hosts" >&2; exit 69 ;;',
		"esac",
		`node_version=${quotePosixShell(SSH_NODE_VERSION)}`,
		`pi_version=${quotePosixShell(piVersion)}`,
		'runtime_root="$HOME/.pi/studio/runtime"',
		'package_parent="$HOME/.pi/studio/packages"',
		'bin_root="$HOME/.pi/studio/bin"',
		'node_root="$runtime_root/node-v$node_version-linux-$node_arch"',
		'package_root="$package_parent/pi-$pi_version"',
		'wrapper="$bin_root/pi"',
		'mkdir -p "$runtime_root" "$package_parent" "$bin_root"',
		'for tool in tar sha256sum; do command -v "$tool" >/dev/null 2>&1 || { echo "Automatic Pi installation needs $tool" >&2; exit 69; }; done',
		'if command -v xz >/dev/null 2>&1; then node_archive_ext=tar.xz; node_sha="$node_sha_xz"; else command -v gzip >/dev/null 2>&1 || { echo "Automatic Pi installation needs xz or gzip" >&2; exit 69; }; node_archive_ext=tar.gz; node_sha="$node_sha_gzip"; fi',
		'install_tmp=""',
		'cleanup() { if [ -n "$install_tmp" ]; then rm -rf -- "$install_tmp"; fi; }',
		"trap cleanup EXIT HUP INT TERM",
		'if [ ! -x "$node_root/bin/node" ] || [ "$("$node_root/bin/node" --version 2>/dev/null || :)" != "v$node_version" ]; then',
		'  install_tmp=$(mktemp -d "$runtime_root/.node.XXXXXX")',
		'  archive="$install_tmp/node.$node_archive_ext"',
		'  node_url="https://nodejs.org/dist/v$node_version/node-v$node_version-linux-$node_arch.$node_archive_ext"',
		'  if command -v curl >/dev/null 2>&1; then curl --fail --location --silent --show-error --output "$archive" "$node_url"; elif command -v wget >/dev/null 2>&1; then wget -q -O "$archive" "$node_url"; else echo "Automatic Pi installation needs curl or wget" >&2; exit 69; fi',
		'  printf "%s  %s\\n" "$node_sha" "$archive" | sha256sum -c - >/dev/null',
		'  mkdir -p "$install_tmp/node"',
		'  if [ "$node_archive_ext" = "tar.xz" ]; then tar -xJf "$archive" -C "$install_tmp/node" --strip-components=1; else tar -xzf "$archive" -C "$install_tmp/node" --strip-components=1; fi',
		'  [ "$("$install_tmp/node/bin/node" --version)" = "v$node_version" ]',
		'  rm -rf -- "$node_root"',
		'  mv -- "$install_tmp/node" "$node_root"',
		'  rm -rf -- "$install_tmp"',
		'  install_tmp=""',
		"fi",
		'export PATH="$node_root/bin:$PATH"',
		'if [ ! -x "$package_root/bin/pi" ] || ! "$package_root/bin/pi" --version >/dev/null 2>&1; then',
		'  rm -rf -- "$package_root"',
		'  mkdir -p "$package_root"',
		`  npm install --global --ignore-scripts --no-audit --no-fund --loglevel=error --prefix "$package_root" ${quotePosixShell(packageSpec)}`,
		"fi",
		'"$package_root/bin/pi" --version >/dev/null',
		'wrapper_tmp="$wrapper.$$"',
		`cat > "$wrapper_tmp" <<EOF
#!/bin/sh
PATH="\\$HOME/.pi/studio/runtime/node-v$node_version-linux-$node_arch/bin:\\$PATH"
export PATH
exec "\\$HOME/.pi/studio/packages/pi-$pi_version/bin/pi" "\\$@"
EOF`,
		'chmod 700 "$wrapper_tmp"',
		'mv -f -- "$wrapper_tmp" "$wrapper"',
		'exec "$wrapper" --version',
	].join("\n");
	return {
		command: "ssh",
		args: [...sshArgs(connection, true), remoteCommand],
		cwd: homedir(),
		piCommand: SSH_MANAGED_PI_COMMAND,
		piVersion,
		nodeVersion: SSH_NODE_VERSION,
	};
}

/**
 * @param {unknown} connectionValue
 * @param {string} remotePath
 * @param {readonly string[]} args
 */
export function createSshGitSpec(connectionValue, remotePath, args) {
	return createSshCliSpec(connectionValue, remotePath, "git", args);
}

/**
 * Create one managed remote worktree on a fresh task branch. The generated
 * name is supplied by the trusted main process and validated before it reaches
 * the fixed remote shell command.
 * @param {unknown} connectionValue
 * @param {string} remotePath
 * @param {unknown} nameValue
 */
export function createSshWorktreeSpec(connectionValue, remotePath, nameValue) {
	const connection = normalizeConnection(connectionValue, false);
	const sourcePath = normalizeConnection({ ...connection, remotePath }, false).remotePath;
	const name = normalizeSshWorktreeName(nameValue);
	const branch = `task/${name}`;
	const worktreePath = `~/.pi/studio/worktrees/${name}`;
	const remoteCommand = [
		"umask 077",
		"export LANG=C LC_ALL=C GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0",
		`cd ${remotePathExpression(sourcePath)}`,
		'worktree_root="$HOME/.pi/studio/worktrees"',
		`worktree_path="$worktree_root"/${quotePosixShell(name)}`,
		'mkdir -p "$worktree_root"',
		"git worktree prune",
		`if git show-ref --verify --quiet ${quotePosixShell(`refs/heads/${branch}`)}; then echo "Remote task branch already exists" >&2; exit 65; fi`,
		'if [ -e "$worktree_path" ]; then echo "Remote task worktree already exists" >&2; exit 65; fi',
		`exec git worktree add -b ${quotePosixShell(branch)} "$worktree_path"`,
	].join(" && ");
	return {
		command: "ssh",
		args: [...sshArgs(connection, true), remoteCommand],
		cwd: homedir(),
		branch,
		worktreePath,
	};
}

/**
 * Remove a clean managed remote worktree through its source repository. Git
 * refuses dirty worktrees, preserving user changes like the local task flow.
 * @param {unknown} connectionValue
 * @param {string} sourceRemotePath
 * @param {unknown} worktreePathValue
 */
export function createSshWorktreeRemoveSpec(connectionValue, sourceRemotePath, worktreePathValue) {
	const connection = normalizeConnection(connectionValue, false);
	const sourcePath = normalizeConnection({ ...connection, remotePath: sourceRemotePath }, false).remotePath;
	const { worktreePath } = normalizeManagedSshWorktreePath(worktreePathValue);
	const remoteCommand = [
		"export LANG=C LC_ALL=C GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0",
		`cd ${remotePathExpression(sourcePath)}`,
		`exec git worktree remove ${remotePathExpression(worktreePath)}`,
	].join(" && ");
	return {
		command: "ssh",
		args: [...sshArgs(connection, true), remoteCommand],
		cwd: homedir(),
		worktreePath,
	};
}

/** @param {unknown} connectionValue */
export function createSshWorktreeListSpec(connectionValue) {
	const connection = normalizeConnection(connectionValue, false);
	const scanCommand = [
		'if [ -d "$worktree_root" ]; then',
		'for worktree_path in "$worktree_root"/*; do',
		'[ -d "$worktree_path" ] && [ ! -L "$worktree_path" ] || continue;',
		'name=${worktree_path##*/};',
		'case "$name" in remote-*) ;; *) continue ;; esac;',
		'case "$name" in *[!a-z0-9._-]*|*..*|*.|*.lock) continue ;; esac;',
		'branch=$(git -C "$worktree_path" symbolic-ref --quiet --short HEAD 2>/dev/null || :);',
		'if [ "$branch" != "task/$name" ]; then continue; fi;',
		'if status=$(git -C "$worktree_path" status --porcelain --untracked-files=normal 2>/dev/null); then',
		'if [ -n "$status" ]; then dirty=1; else dirty=0; fi;',
		'else dirty=?; fi;',
		`printf '${SSH_WORKTREE_METADATA_PREFIX}\\t%s\\t%s\\t%s\\n' "$name" "$dirty" "$branch";`,
		"done;",
		"fi",
	].join(" ");
	const remoteCommand = [
		"export LANG=C LC_ALL=C GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0",
		'worktree_root="$HOME/.pi/studio/worktrees"',
		scanCommand,
	].join(" && ");
	return {
		command: "ssh",
		args: [...sshArgs(connection, true), remoteCommand],
		cwd: homedir(),
	};
}

/** @param {unknown} value */
export function parseSshWorktreeList(value) {
	const output = Buffer.isBuffer(value) ? value.toString("utf8") : String(value ?? "");
	const entries = [];
	const seen = new Set();
	for (const line of output.split(/\r?\n/u)) {
		if (!line.startsWith(`${SSH_WORKTREE_METADATA_PREFIX}\t`)) continue;
		const fields = line.split("\t");
		if (fields.length !== 4) throw new Error("Remote worktree metadata is invalid");
		const rawName = fields[1];
		const name = normalizeSshWorktreeName(rawName);
		const branch = text(fields[3], "Remote worktree branch", { max: 240 });
		if (rawName !== name || !name.startsWith("remote-") || branch !== `task/${name}` || seen.has(name)) {
			throw new Error("Remote worktree metadata is invalid");
		}
		const dirty = fields[2] === "1" ? true : fields[2] === "0" ? false : fields[2] === "?" ? null : undefined;
		if (dirty === undefined) throw new Error("Remote worktree metadata is invalid");
		seen.add(name);
		entries.push({ worktreePath: `~/.pi/studio/worktrees/${name}`, branch, dirty });
		if (entries.length >= 100) break;
	}
	return entries;
}

/** @param {unknown} connectionValue @param {unknown} worktreePathValue */
export function createSshWorktreeDeleteSpec(connectionValue, worktreePathValue) {
	const connection = normalizeConnection(connectionValue, false);
	const { name, worktreePath } = normalizeManagedSshWorktreePath(worktreePathValue);
	const remoteCommand = [
		"umask 077",
		"export LANG=C LC_ALL=C GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0",
		`worktree_path=${remotePathExpression(worktreePath)}`,
		'if [ ! -e "$worktree_path" ]; then exit 0; fi',
		'if [ ! -d "$worktree_path" ] || [ -L "$worktree_path" ]; then echo "Remote worktree is not a managed directory" >&2; exit 66; fi',
		'branch=$(git -C "$worktree_path" symbolic-ref --quiet --short HEAD 2>/dev/null || :)',
		`if [ "$branch" != ${quotePosixShell(`task/${name}`)} ]; then echo "Remote worktree branch is not managed by Pi Studio" >&2; exit 66; fi`,
		'source_path=$(git -C "$worktree_path" worktree list --porcelain | sed -n "1s/^worktree //p")',
		'if [ -z "$source_path" ] || [ ! -d "$source_path" ]; then echo "Remote worktree source repository was not found" >&2; exit 66; fi',
		'cd "$source_path"',
		'exec git worktree remove --force "$worktree_path"',
	].join(" && ");
	return {
		command: "ssh",
		args: [...sshArgs(connection, true), remoteCommand],
		cwd: homedir(),
		worktreePath,
	};
}

/**
 * @param {unknown} connectionValue
 * @param {string} remotePath
 * @param {"git" | "gh"} command
 * @param {readonly string[]} args
 */
export function createSshCliSpec(connectionValue, remotePath, command, args) {
	const connection = normalizeConnection(connectionValue, false);
	if (command !== "git" && command !== "gh") throw new Error("Unsupported remote CLI command");
	const commandArgs = args.map((arg) => {
		const value = String(arg);
		if (value.includes("\0")) throw new Error("Remote CLI arguments cannot contain NUL bytes");
		return quotePosixShell(value);
	});
	const environment = command === "git"
		? "GIT_OPTIONAL_LOCKS=0 LANG=C LC_ALL=C GIT_TERMINAL_PROMPT=0"
		: "GH_NO_UPDATE_NOTIFIER=1 GH_PROMPT_DISABLED=1 NO_COLOR=1";
	const remoteCommand = [
		`cd ${remotePathExpression(remotePath)}`,
		`${environment} exec ${command}${commandArgs.length > 0 ? ` ${commandArgs.join(" ")}` : ""}`,
	].join(" && ");
	return {
		command: "ssh",
		args: [...sshArgs(connection, true), remoteCommand],
		cwd: homedir(),
	};
}

/** @param {unknown} filePath */
function normalizeRemoteWorkspacePath(filePath) {
	const target = String(filePath ?? "");
	const normalized = posix.normalize(target);
	if (
		!target ||
		/[\u0000-\u001f\u007f]/u.test(target) ||
		posix.isAbsolute(target) ||
		normalized === "." ||
		normalized === ".." ||
		normalized.startsWith("../") ||
		target.split("/").includes("..")
	) {
		throw new Error("Remote path must stay inside the workspace");
	}
	return normalized;
}

/**
 * Open a remote regular file once, verify the opened descriptor resolves
 * inside the physical workspace, emit bounded metadata on stderr, then stream
 * its bytes on stdout. Linux `/proc` keeps the containment check and read on
 * the same descriptor so a symlink swap cannot redirect the transfer.
 * @param {unknown} connectionValue
 * @param {string} remotePath
 * @param {unknown} filePath
 * @param {number} [maxBytes]
 */
export function createSshFileReadSpec(connectionValue, remotePath, filePath, maxBytes) {
	const connection = normalizeConnection(connectionValue, false);
	const relativePath = normalizeRemoteWorkspacePath(filePath);
	if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes >= Number.MAX_SAFE_INTEGER)) {
		throw new Error("Remote file byte limit is invalid");
	}
	const targetExpression = quotePosixShell(`./${relativePath}`);
	const readCommand = maxBytes === undefined
		? "cat <&3"
		: `if [ "$file_size" -le ${maxBytes} ]; then head -c ${maxBytes + 1} <&3; fi`;
	const remoteCommand = [
		"umask 077",
		"export LANG=C LC_ALL=C",
		`cd ${remotePathExpression(remotePath)}`,
		'workspace_directory=$(pwd -P)',
		`if [ ! -f ${targetExpression} ]; then echo "Remote artifact is not a file" >&2; exit 66; fi`,
		`exec 3<${targetExpression}`,
		'target_path=$(readlink -f "/proc/$$/fd/3")',
		'if [ "$workspace_directory" != "/" ]; then case "$target_path" in "$workspace_directory"/*) : ;; *) echo "Remote artifact path escaped the workspace" >&2; exit 64 ;; esac; fi',
		'file_size=$(stat -Lc %s "/proc/$$/fd/3")',
		'file_modified=$(stat -Lc %Y "/proc/$$/fd/3")',
		`printf '${SSH_FILE_METADATA_PREFIX} %s %s\\n' "$file_size" "$file_modified" >&2`,
		readCommand,
	].join(" && ");
	return {
		command: "ssh",
		args: [...sshArgs(connection, true), remoteCommand],
		cwd: homedir(),
		relativePath,
	};
}

/** @param {unknown} value */
export function parseSshFileMetadata(value) {
	const output = Buffer.isBuffer(value) ? value.toString("utf8") : String(value ?? "");
	const match = output.match(new RegExp(`${SSH_FILE_METADATA_PREFIX} ([0-9]+) (-?[0-9]+)(?:\\r?\\n|$)`, "u"));
	if (!match) throw new Error("Remote file metadata was not returned");
	const size = Number(match[1]);
	const modifiedAt = Number(match[2]) * 1000;
	if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(modifiedAt)) {
		throw new Error("Remote file metadata is invalid");
	}
	return { size, modifiedAt };
}

/**
 * @param {unknown} connectionValue
 * @param {string} remotePath
 * @param {unknown} filePath
 */
export function createSshTrashSpec(connectionValue, remotePath, filePath) {
	const connection = normalizeConnection(connectionValue, false);
	const normalized = normalizeRemoteWorkspacePath(filePath);
	const trashName = `${Date.now()}-${randomUUID()}-${posix.basename(normalized).slice(0, 50)}`;
	const trashDirectory = '"$HOME/.pi/studio/trash"';
	const targetExpression = quotePosixShell(`./${normalized}`);
	const remoteCommand = [
		"umask 077",
		`cd ${remotePathExpression(remotePath)}`,
		'workspace_directory=$(pwd -P)',
		`target_directory=$(cd "$(dirname ${targetExpression})" && pwd -P)`,
		`target_name=$(basename ${targetExpression})`,
		'if [ "$workspace_directory" != "/" ]; then case "$target_directory" in "$workspace_directory"|"$workspace_directory"/*) : ;; *) echo "Remote trash path escaped the workspace" >&2; exit 64 ;; esac; fi',
		`mkdir -p ${trashDirectory}`,
		`mv -- "$target_directory/$target_name" ${trashDirectory}/${quotePosixShell(trashName)}`,
	].join(" && ");
	return {
		command: "ssh",
		args: [...sshArgs(connection, true), remoteCommand],
		cwd: homedir(),
		trashPath: `~/.pi/studio/trash/${trashName}`,
	};
}
