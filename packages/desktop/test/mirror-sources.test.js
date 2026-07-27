import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	CUSTOM_SOURCE_ID,
	MIRROR_MANAGERS,
	MIRROR_PRESETS,
	applySource,
	getConfigPath,
	identifySource,
	parseCargoRegistry,
	parseNpmrcRegistry,
	parsePipIndexUrl,
	requirePreset,
	readStatus,
	setCargoRegistry,
	setNpmrcRegistry,
	setPipIndexUrl,
} from "../src/mirror-sources.js";

const enoent = () => {
	const error = new Error("not found");
	// @ts-expect-error test fixture mimics fs errors
	error.code = "ENOENT";
	return Promise.reject(error);
};

describe("presets", () => {
	it("gives every manager a default preset", () => {
		for (const manager of MIRROR_MANAGERS) {
			const presets = MIRROR_PRESETS[manager];
			assert.ok(presets.length > 0, manager);
			assert.ok(
				presets.some((preset) => preset.id === "default"),
				`${manager} needs a default preset`,
			);
		}
	});

	it("labels every preset in both languages", () => {
		for (const manager of MIRROR_MANAGERS) {
			for (const preset of MIRROR_PRESETS[manager]) {
				assert.ok(preset.nameEn.trim(), `${manager}/${preset.id} nameEn`);
				assert.ok(preset.nameZh.trim(), `${manager}/${preset.id} nameZh`);
			}
		}
	});

	it("rejects unknown managers and sources", () => {
		assert.throws(() => requirePreset("pnpm", "default"), /Unknown package manager/);
		assert.throws(() => requirePreset("npm", "nope"), /Unknown mirror source/);
	});
});

describe("identifySource", () => {
	it("treats an unset registry as the default", () => {
		assert.equal(identifySource("npm", ""), "default");
		assert.equal(identifySource("npm", "   "), "default");
	});

	it("ignores trailing slashes and case", () => {
		assert.equal(identifySource("npm", "https://Registry.NPMJS.org"), "default");
		assert.equal(identifySource("npm", "https://registry.npmmirror.com"), "npmmirror");
	});

	it("reports unrecognized registries as custom", () => {
		assert.equal(identifySource("npm", "https://npm.internal.corp/"), CUSTOM_SOURCE_ID);
	});
});

describe("npmrc", () => {
	it("reads the global registry only", () => {
		assert.equal(parseNpmrcRegistry("registry=https://a/\n"), "https://a/");
		assert.equal(parseNpmrcRegistry("@scope:registry=https://scoped/\n"), "");
		assert.equal(parseNpmrcRegistry("# registry=https://commented/\n"), "");
		assert.equal(parseNpmrcRegistry(""), "");
	});

	it("keeps auth tokens and scoped registries when switching", () => {
		const before = "//registry.npmjs.org/:_authToken=secret\n@my:registry=https://scoped/\nregistry=https://a/\n";
		const after = setNpmrcRegistry(before, "https://registry.npmmirror.com/");
		assert.match(after, /_authToken=secret/);
		assert.match(after, /@my:registry=https:\/\/scoped\//);
		assert.equal(parseNpmrcRegistry(after), "https://registry.npmmirror.com/");
	});

	it("appends the registry when the file has none", () => {
		const after = setNpmrcRegistry("save-exact=true\n", "https://b/");
		assert.equal(parseNpmrcRegistry(after), "https://b/");
		assert.match(after, /save-exact=true/);
	});

	it("removes the line for the default source", () => {
		const after = setNpmrcRegistry("save-exact=true\nregistry=https://a/\n", "");
		assert.equal(parseNpmrcRegistry(after), "");
		assert.match(after, /save-exact=true/);
	});

	it("collapses duplicate registry lines", () => {
		const after = setNpmrcRegistry("registry=https://a/\nregistry=https://b/\n", "https://c/");
		assert.equal(after.match(/^registry=/gm)?.length, 1);
	});

	it("round-trips every preset", () => {
		for (const preset of MIRROR_PRESETS.npm) {
			const after = setNpmrcRegistry("", preset.url);
			assert.equal(identifySource("npm", parseNpmrcRegistry(after)), preset.id);
		}
	});

	it("reports the last registry line (npm last-wins)", () => {
		// npm resolves duplicate registry= by last-wins; the parser must match.
		const dup = "registry=https://registry.npmjs.org/\nregistry=https://registry.npmmirror.com/\n";
		assert.equal(parseNpmrcRegistry(dup), "https://registry.npmmirror.com/");
		assert.equal(identifySource("npm", parseNpmrcRegistry(dup)), "npmmirror");
	});
});

describe("pip config", () => {
	it("only reads index-url under [global]", () => {
		assert.equal(parsePipIndexUrl("[global]\nindex-url = https://a/\n"), "https://a/");
		assert.equal(parsePipIndexUrl("[install]\nindex-url = https://a/\n"), "");
		assert.equal(parsePipIndexUrl(""), "");
	});

	it("creates [global] when absent", () => {
		const after = setPipIndexUrl("", "https://a/");
		assert.match(after, /\[global\]/);
		assert.equal(parsePipIndexUrl(after), "https://a/");
	});

	it("preserves unrelated sections", () => {
		const before = "[global]\ntimeout = 60\nindex-url = https://a/\n\n[install]\nuser = true\n";
		const after = setPipIndexUrl(before, "https://mirrors.aliyun.com/pypi/simple/");
		assert.equal(parsePipIndexUrl(after), "https://mirrors.aliyun.com/pypi/simple/");
		assert.match(after, /timeout = 60/);
		assert.match(after, /\[install\]\nuser = true/);
	});

	it("adds the key to an existing [global] that lacks it", () => {
		const after = setPipIndexUrl("[global]\ntimeout = 60\n\n[install]\nuser = true\n", "https://a/");
		assert.equal(parsePipIndexUrl(after), "https://a/");
		assert.match(after, /user = true/);
	});

	it("removes the key for the default source", () => {
		const after = setPipIndexUrl("[global]\ntimeout = 60\nindex-url = https://a/\n", "");
		assert.equal(parsePipIndexUrl(after), "");
		assert.match(after, /timeout = 60/);
	});

	it("round-trips every preset", () => {
		for (const preset of MIRROR_PRESETS.pip) {
			const after = setPipIndexUrl("", preset.url);
			assert.equal(identifySource("pip", parsePipIndexUrl(after)), preset.id);
		}
	});
});

describe("cargo config", () => {
	it("resolves replace-with to the mirror registry", () => {
		const content = '[source.crates-io]\nreplace-with = "m"\n\n[source.m]\nregistry = "sparse+https://a/"\n';
		assert.equal(parseCargoRegistry(content), "sparse+https://a/");
	});

	it("returns empty without a replacement", () => {
		assert.equal(parseCargoRegistry(""), "");
		assert.equal(parseCargoRegistry('[build]\njobs = 4\n'), "");
	});

	it("returns empty when replace-with points at a missing table", () => {
		assert.equal(parseCargoRegistry('[source.crates-io]\nreplace-with = "ghost"\n'), "");
	});

	it("preserves unrelated tables when switching", () => {
		const before = '[build]\njobs = 4\n\n[net]\nretry = 3\n';
		const after = setCargoRegistry(before, "sparse+https://mirror/");
		assert.equal(parseCargoRegistry(after), "sparse+https://mirror/");
		assert.match(after, /\[build\]\njobs = 4/);
		assert.match(after, /\[net\]\nretry = 3/);
	});

	it("restores crates.io for the default source", () => {
		const before = '[build]\njobs = 4\n\n[source.crates-io]\nreplace-with = "m"\n\n[source.m]\nregistry = "sparse+https://a/"\n';
		const after = setCargoRegistry(before, "");
		assert.equal(parseCargoRegistry(after), "");
		assert.doesNotMatch(after, /replace-with/);
		assert.match(after, /jobs = 4/);
	});

	it("does not accumulate tables when switching twice", () => {
		const once = setCargoRegistry("", "sparse+https://a/");
		const twice = setCargoRegistry(once, "sparse+https://b/");
		assert.equal(twice.match(/\[source\.crates-io\]/g)?.length, 1);
		assert.equal(parseCargoRegistry(twice), "sparse+https://b/");
	});

	it("round-trips every preset", () => {
		for (const preset of MIRROR_PRESETS.cargo) {
			const after = setCargoRegistry("", preset.url);
			assert.equal(identifySource("cargo", parseCargoRegistry(after)), preset.id);
		}
	});

	it("preserves non-replace-with keys in [source.crates-io] when switching", () => {
		const before =
			'[source.crates-io]\nreplace-with = "m"\nprotocol = "sparse"\ncheck-revoked = false\n\n[source.m]\nregistry = "https://a/"\n';
		const after = setCargoRegistry(before, "sparse+https://b/");
		assert.match(after, /protocol = "sparse"/);
		assert.match(after, /check-revoked = false/);
		assert.equal(parseCargoRegistry(after), "sparse+https://b/");
	});

	it("preserves non-replace-with keys when restoring the default", () => {
		const before =
			'[source.crates-io]\nreplace-with = "m"\nprotocol = "sparse"\n\n[source.m]\nregistry = "https://a/"\n';
		const after = setCargoRegistry(before, "");
		assert.equal(parseCargoRegistry(after), "");
		assert.doesNotMatch(after, /replace-with/);
		assert.match(after, /protocol = "sparse"/);
	});
});

describe("getConfigPath", () => {
	const home = join("/home", "dev");

	it("places npm and cargo configs under the home directory", () => {
		assert.equal(getConfigPath("npm", { home }), join(home, ".npmrc"));
		assert.equal(getConfigPath("cargo", { home }), join(home, ".cargo", "config.toml"));
	});

	it("uses pip.ini under APPDATA on Windows", () => {
		const appData = join("C:", "Users", "dev", "AppData", "Roaming");
		assert.equal(getConfigPath("pip", { home, platform: "win32", appData }), join(appData, "pip", "pip.ini"));
	});

	it("falls back to a default APPDATA location on Windows", () => {
		const path = getConfigPath("pip", { home, platform: "win32", appData: undefined });
		assert.match(path, /pip\.ini$/);
	});

	it("uses pip.conf on POSIX", () => {
		assert.equal(getConfigPath("pip", { home, platform: "linux" }), join(home, ".config", "pip", "pip.conf"));
	});

	it("rejects unknown managers", () => {
		assert.throws(() => getConfigPath("pnpm", { home }), /Unknown package manager/);
	});
});

describe("readStatus", () => {
	const home = join("/home", "dev");

	it("reports defaults when no config file exists", async () => {
		const { sources } = await readStatus({ home, platform: "linux", readFileImpl: enoent });
		assert.equal(sources.length, MIRROR_MANAGERS.length);
		for (const source of sources) {
			assert.equal(source.current, "default");
			assert.equal(source.configExists, false);
			assert.equal(source.currentUrl, "");
		}
	});

	it("reports the configured mirror per manager", async () => {
		const files = {
			[join(home, ".npmrc")]: "registry=https://registry.npmmirror.com/\n",
			[join(home, ".config", "pip", "pip.conf")]: "[global]\nindex-url = https://mirrors.aliyun.com/pypi/simple/\n",
		};
		const { sources } = await readStatus({
			home,
			platform: "linux",
			readFileImpl: (path) => (path in files ? Promise.resolve(files[path]) : enoent()),
		});
		const byManager = Object.fromEntries(sources.map((source) => [source.manager, source]));
		assert.equal(byManager.npm.current, "npmmirror");
		assert.equal(byManager.npm.configExists, true);
		assert.equal(byManager.pip.current, "aliyun");
		assert.equal(byManager.cargo.current, "default");
		assert.equal(byManager.cargo.configExists, false);
	});

	it("surfaces unreadable config files instead of hiding them", async () => {
		await assert.rejects(
			readStatus({ home, platform: "linux", readFileImpl: () => Promise.reject(new Error("EACCES")) }),
			/EACCES/,
		);
	});
});

describe("applySource", () => {
	const home = join("/home", "dev");

	it("writes the selected mirror and creates the parent directory", async () => {
		/** @type {{ path: string, content: string }[]} */
		const writes = [];
		/** @type {string[]} */
		const dirs = [];
		const result = await applySource("npm", "npmmirror", {
			home,
			platform: "linux",
			readFileImpl: enoent,
			writeFileImpl: (path, content) => {
				writes.push({ path, content });
				return Promise.resolve();
			},
			mkdirImpl: (path) => {
				dirs.push(path);
				return Promise.resolve(undefined);
			},
		});
		assert.equal(result.ok, true);
		assert.equal(result.url, "https://registry.npmmirror.com/");
		assert.equal(writes.length, 1);
		assert.equal(writes[0].path, join(home, ".npmrc"));
		assert.equal(parseNpmrcRegistry(writes[0].content), "https://registry.npmmirror.com/");
		assert.deepEqual(dirs, [home]);
	});

	it("leaves the disk untouched when defaulting with no existing file", async () => {
		let wrote = false;
		const result = await applySource("npm", "default", {
			home,
			platform: "linux",
			readFileImpl: enoent,
			writeFileImpl: () => {
				wrote = true;
				return Promise.resolve();
			},
			mkdirImpl: () => Promise.resolve(undefined),
		});
		assert.equal(result.ok, true);
		assert.equal(wrote, false);
	});

	it("rejects an unknown source before touching the filesystem", async () => {
		await assert.rejects(
			applySource("npm", "nope", {
				home,
				platform: "linux",
				readFileImpl: enoent,
				writeFileImpl: () => Promise.reject(new Error("must not write")),
			}),
			/Unknown mirror source/,
		);
	});
});
