/**
 * Registry mirror switching for npm, pip and cargo.
 *
 * Each package manager keeps its registry in a different config format, so the
 * parse/serialize helpers here are pure and unit-tested without Electron; only
 * readStatus/applySource touch the filesystem.
 *
 * Every mirror URL below was reachability-checked before being listed. Notably
 * absent: the Aliyun and Tsinghua npm paths, which are not npm registries (they
 * 404), and Tsinghua's rustup path, which mirrors toolchains rather than the
 * crates index.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * @typedef {"npm" | "pip" | "cargo"} MirrorManager
 * @typedef {{ id: string, nameEn: string, nameZh: string, url: string }} MirrorPreset
 * @typedef {{ manager: MirrorManager, current: string, currentUrl: string, configExists: boolean }} MirrorStatus
 */

export const CUSTOM_SOURCE_ID = "custom";

/** @type {Record<MirrorManager, MirrorPreset[]>} */
export const MIRROR_PRESETS = {
	npm: [
		{ id: "default", nameEn: "Official", nameZh: "官方源", url: "https://registry.npmjs.org/" },
		{ id: "npmmirror", nameEn: "npmmirror (Alibaba)", nameZh: "npmmirror（阿里）", url: "https://registry.npmmirror.com/" },
	],
	pip: [
		{ id: "default", nameEn: "Official (PyPI)", nameZh: "官方源（PyPI）", url: "https://pypi.org/simple/" },
		{
			id: "tsinghua",
			nameEn: "Tsinghua TUNA",
			nameZh: "清华 TUNA",
			url: "https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple/",
		},
		{ id: "aliyun", nameEn: "Aliyun", nameZh: "阿里云", url: "https://mirrors.aliyun.com/pypi/simple/" },
	],
	cargo: [
		{ id: "default", nameEn: "Official (crates.io)", nameZh: "官方源（crates.io）", url: "" },
		{
			id: "tsinghua",
			nameEn: "Tsinghua TUNA",
			nameZh: "清华 TUNA",
			url: "sparse+https://mirrors.tuna.tsinghua.edu.cn/crates.io-index/",
		},
	],
};

/** @type {MirrorManager[]} */
export const MIRROR_MANAGERS = ["npm", "pip", "cargo"];

/**
 * @param {MirrorManager} manager
 * @param {string} sourceId
 * @returns {MirrorPreset}
 */
export function requirePreset(manager, sourceId) {
	const presets = MIRROR_PRESETS[manager];
	if (!presets) throw new Error(`Unknown package manager: ${manager}`);
	const preset = presets.find((entry) => entry.id === sourceId);
	if (!preset) throw new Error(`Unknown mirror source for ${manager}: ${sourceId}`);
	return preset;
}

/**
 * Normalizes for comparison only: registry URLs differ harmlessly by trailing
 * slash and case, so `https://Registry.NPMJS.org` still matches the official preset.
 * @param {string} url
 */
function normalizeUrl(url) {
	return url.trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * @param {MirrorManager} manager
 * @param {string} url
 * @returns {string} preset id, or CUSTOM_SOURCE_ID when the URL matches none
 */
export function identifySource(manager, url) {
	const normalized = normalizeUrl(url);
	if (!normalized) return "default";
	const match = MIRROR_PRESETS[manager].find((preset) => preset.url && normalizeUrl(preset.url) === normalized);
	return match ? match.id : CUSTOM_SOURCE_ID;
}

/* -------------------------------------------------------------------------- */
/* npm — ~/.npmrc, a flat key=value file                                       */
/* -------------------------------------------------------------------------- */

/**
 * @param {string} content
 * @returns {string} the configured registry, or "" when unset
 */
export function parseNpmrcRegistry(content) {
	// npm resolves duplicate `registry=` lines by last-wins (.npmrc/ini
	// semantics), so we must report the last match — otherwise the UI shows a
	// different mirror than npm actually uses.
	let registry = "";
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
		// Only the global `registry` key; scoped keys like `@scope:registry` are left alone.
		const match = /^registry\s*=\s*(.+)$/i.exec(trimmed);
		if (match) registry = match[1].trim();
	}
	return registry;
}

/**
 * Rewrites the global registry line, preserving comments, scoped registries and
 * auth tokens. An empty url removes the line so npm falls back to its default.
 * @param {string} content
 * @param {string} url
 */
export function setNpmrcRegistry(content, url) {
	const lines = content.split(/\r?\n/);
	/** @type {string[]} */
	const out = [];
	let replaced = false;
	for (const line of lines) {
		const trimmed = line.trim();
		const isRegistryLine = !trimmed.startsWith("#") && !trimmed.startsWith(";") && /^registry\s*=/i.test(trimmed);
		if (!isRegistryLine) {
			out.push(line);
			continue;
		}
		if (!url) continue; // drop it: back to npm's built-in default
		if (replaced) continue; // collapse duplicates
		out.push(`registry=${url}`);
		replaced = true;
	}
	if (url && !replaced) {
		while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
		out.push(`registry=${url}`);
	}
	const joined = out.join("\n").replace(/\n{3,}/g, "\n\n");
	return joined.endsWith("\n") || joined === "" ? joined : `${joined}\n`;
}

/* -------------------------------------------------------------------------- */
/* pip — pip.ini / pip.conf, an INI file keyed under [global]                   */
/* -------------------------------------------------------------------------- */

/**
 * @param {string} content
 * @returns {string} index-url under [global], or "" when unset
 */
export function parsePipIndexUrl(content) {
	let inGlobal = false;
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
		const section = /^\[(.+)\]$/.exec(trimmed);
		if (section) {
			inGlobal = section[1].trim().toLowerCase() === "global";
			continue;
		}
		if (!inGlobal) continue;
		const match = /^index-url\s*=\s*(.+)$/i.exec(trimmed);
		if (match) return match[1].trim();
	}
	return "";
}

/**
 * Sets index-url inside [global], creating the section when absent and leaving
 * every other section untouched. An empty url removes the key.
 * @param {string} content
 * @param {string} url
 */
export function setPipIndexUrl(content, url) {
	const lines = content.split(/\r?\n/);
	/** @type {string[]} */
	const out = [];
	let inGlobal = false;
	let wrote = false;
	let globalSeen = false;

	for (const line of lines) {
		const trimmed = line.trim();
		const section = /^\[(.+)\]$/.exec(trimmed);
		if (section) {
			// Leaving [global] without having written the key: append it here.
			if (inGlobal && url && !wrote) {
				out.push(`index-url = ${url}`);
				wrote = true;
			}
			inGlobal = section[1].trim().toLowerCase() === "global";
			if (inGlobal) globalSeen = true;
			out.push(line);
			continue;
		}
		const isIndexUrl = inGlobal && !trimmed.startsWith("#") && !trimmed.startsWith(";") && /^index-url\s*=/i.test(trimmed);
		if (!isIndexUrl) {
			out.push(line);
			continue;
		}
		if (!url || wrote) continue;
		out.push(`index-url = ${url}`);
		wrote = true;
	}

	if (url && !wrote) {
		// Reaching here means no `index-url` was written during the loop. That
		// happens only when [global] has no index-url AND is the trailing
		// section (inGlobal still true at EOF) — so the key appends here — or
		// when [global] never appeared at all (globalSeen false), in which case
		// we create it. The earlier "splice after [global]" branch was dead:
		// a non-trailing [global] always triggers the write in the loop body.
		if (inGlobal) {
			out.push(`index-url = ${url}`);
		} else if (!globalSeen) {
			while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
			if (out.length > 0) out.push("");
			out.push("[global]", `index-url = ${url}`);
		}
	}

	const joined = out.join("\n").replace(/\n{3,}/g, "\n\n");
	return joined.endsWith("\n") || joined === "" ? joined : `${joined}\n`;
}

/* -------------------------------------------------------------------------- */
/* cargo — ~/.cargo/config.toml, [source.*] tables                             */
/* -------------------------------------------------------------------------- */

const CARGO_SOURCE_NAME = "pi-mirror";

/**
 * Reads the crates.io replacement, if any. Returns the mirror's registry URL so
 * the caller can match it against a preset.
 * @param {string} content
 * @returns {string} replacement registry URL, or "" when using crates.io directly
 */
export function parseCargoRegistry(content) {
	/** @type {string | null} */
	let replaceWith = null;
	/** @type {Record<string, string>} */
	const sources = {};
	let section = "";

	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const header = /^\[(.+)\]$/.exec(trimmed);
		if (header) {
			section = header[1].trim();
			continue;
		}
		const pair = /^([\w-]+)\s*=\s*(.+)$/.exec(trimmed);
		if (!pair) continue;
		const key = pair[1].toLowerCase();
		const value = pair[2].trim().replace(/^["']|["']$/g, "");
		if (section === "source.crates-io" && key === "replace-with") replaceWith = value;
		else if (section.startsWith("source.") && key === "registry") sources[section.slice("source.".length)] = value;
	}

	if (!replaceWith) return "";
	return sources[replaceWith] ?? "";
}

/**
 * Points crates.io at a mirror, or restores the default when url is empty.
 * Unrelated tables (build, target, net, ...) are preserved verbatim.
 * @param {string} content
 * @param {string} url
 */
export function setCargoRegistry(content, url) {
	/** @type {{ name: string, lines: string[] }[]} */
	const blocks = [];
	/** @type {string[]} */
	const preamble = [];

	for (const line of content.split(/\r?\n/)) {
		const header = /^\[(.+)\]$/.exec(line.trim());
		if (header) blocks.push({ name: header[1].trim(), lines: [line] });
		else if (blocks.length === 0) preamble.push(line);
		else blocks[blocks.length - 1].lines.push(line);
	}

	// Preserve user keys in [source.crates-io] other than `replace-with`
	// (e.g. `protocol = "sparse"`, `check-revoked = false`); dropping them
	// was silent data loss. The `replace-with` line itself is owned by us.
	/** @type {string[]} */
	const cratesIoExtras = [];
	for (const block of blocks) {
		if (block.name !== "source.crates-io") continue;
		for (const line of block.lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("[")) continue;
			if (/^replace-with\s*=/i.test(trimmed)) continue;
			cratesIoExtras.push(line);
		}
	}

	// Drop the tables we own; the crates-io block is rewritten below carrying
	// its preserved keys, and the named mirror table is rewritten from scratch.
	const kept = blocks.filter((block) => {
		if (block.name === "source.crates-io") return false;
		return !(block.name.startsWith("source.") && block.name.slice("source.".length) === CARGO_SOURCE_NAME);
	});

	/** @type {string[]} */
	const out = [...preamble];
	for (const block of kept) out.push(...block.lines);
	while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();

	if (url) {
		if (out.length > 0) out.push("");
		out.push("[source.crates-io]", `replace-with = "${CARGO_SOURCE_NAME}"`, ...cratesIoExtras, "", `[source.${CARGO_SOURCE_NAME}]`, `registry = "${url}"`);
	} else if (cratesIoExtras.length > 0) {
		// Restoring the default: keep the user's other crates-io keys, just
		// drop the replace-with line (already excluded above).
		if (out.length > 0) out.push("");
		out.push("[source.crates-io]", ...cratesIoExtras);
	}

	const joined = out.join("\n").replace(/\n{3,}/g, "\n\n");
	return joined.endsWith("\n") || joined === "" ? joined : `${joined}\n`;
}

/* -------------------------------------------------------------------------- */
/* Filesystem layer                                                            */
/* -------------------------------------------------------------------------- */

/**
 * @param {MirrorManager} manager
 * @param {{ home?: string, platform?: string, appData?: string }} [env]
 * @returns {string}
 */
export function getConfigPath(manager, env = {}) {
	const home = env.home ?? homedir();
	const platform = env.platform ?? process.platform;
	if (manager === "npm") return join(home, ".npmrc");
	if (manager === "cargo") return join(home, ".cargo", "config.toml");
	if (manager === "pip") {
		if (platform === "win32") {
			const appData = env.appData ?? process.env.APPDATA ?? join(home, "AppData", "Roaming");
			return join(appData, "pip", "pip.ini");
		}
		return join(home, ".config", "pip", "pip.conf");
	}
	throw new Error(`Unknown package manager: ${manager}`);
}

const PARSERS = {
	npm: parseNpmrcRegistry,
	pip: parsePipIndexUrl,
	cargo: parseCargoRegistry,
};

const SERIALIZERS = {
	npm: setNpmrcRegistry,
	pip: setPipIndexUrl,
	cargo: setCargoRegistry,
};

/**
 * @param {string} path
 * @param {{ readFileImpl?: typeof readFile }} [deps]
 * @returns {Promise<{ content: string, exists: boolean }>}
 */
async function readConfig(path, deps = {}) {
	const read = deps.readFileImpl ?? readFile;
	try {
		return { content: await read(path, "utf8"), exists: true };
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
			return { content: "", exists: false };
		}
		throw error;
	}
}

/**
 * Current mirror for every supported manager.
 * @param {{ home?: string, platform?: string, appData?: string, readFileImpl?: typeof readFile }} [deps]
 * @returns {Promise<{ sources: MirrorStatus[] }>}
 */
export async function readStatus(deps = {}) {
	const sources = await Promise.all(
		MIRROR_MANAGERS.map(async (manager) => {
			const path = getConfigPath(manager, deps);
			const { content, exists } = await readConfig(path, deps);
			const url = exists ? PARSERS[manager](content) : "";
			return {
				manager,
				current: identifySource(manager, url),
				currentUrl: url,
				configExists: exists,
			};
		}),
	);
	return { sources };
}

/**
 * Switches one manager to a preset, creating the config file if needed.
 * @param {MirrorManager} manager
 * @param {string} sourceId
 * @param {{ home?: string, platform?: string, appData?: string, readFileImpl?: typeof readFile, writeFileImpl?: typeof writeFile, mkdirImpl?: typeof mkdir }} [deps]
 */
export async function applySource(manager, sourceId, deps = {}) {
	const preset = requirePreset(manager, sourceId);
	const path = getConfigPath(manager, deps);
	const { content, exists } = await readConfig(path, deps);
	const next = SERIALIZERS[manager](content, preset.url);

	const write = deps.writeFileImpl ?? writeFile;
	const makeDir = deps.mkdirImpl ?? mkdir;
	// Selecting the official source is a no-op when the user has no config file:
	// that is already the tool's default, so don't create a file to say so.
	if (!exists && (sourceId === "default" || next.trim() === "")) {
		return { ok: true, manager, sourceId, url: preset.url, path, skipped: true };
	}
	await makeDir(dirname(path), { recursive: true });
	await write(path, next, "utf8");
	return { ok: true, manager, sourceId, url: preset.url, path };
}
