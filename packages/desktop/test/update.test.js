import assert from "node:assert/strict";
import test from "node:test";
import { checkDesktopUpdate, isNewerDesktopVersion } from "../src/update.js";

function latestRelease(overrides = {}) {
	return {
		tag_name: "v0.1.1",
		html_url: "https://github.com/s1oopX/pi-studio-dev/releases/tag/v0.1.1",
		draft: false,
		prerelease: false,
		assets: [
			{
				name: "PiStudio-Dev-0.1.1.exe",
				browser_download_url: "https://github.com/s1oopX/pi-studio-dev/releases/download/v0.1.1/PiStudio-Dev-0.1.1.exe",
			},
		],
		...overrides,
	};
}

test("compares stable desktop versions", () => {
	assert.equal(isNewerDesktopVersion("0.1.1", "0.1.0"), true);
	assert.equal(isNewerDesktopVersion("0.1.0", "0.1.0"), false);
	assert.equal(isNewerDesktopVersion("0.0.9", "0.1.0"), false);
	assert.equal(isNewerDesktopVersion("1.0.0", "0.9.9"), true);
	assert.equal(isNewerDesktopVersion("1.0.0", "1.0.0-beta.2"), true);
	assert.equal(isNewerDesktopVersion("invalid", "0.1.0"), false);
});

test("treats a missing GitHub release as no published update", async () => {
	const result = await checkDesktopUpdate("0.1.0", {
		fetchImpl: async () => new Response(null, { status: 404 }),
	});
	assert.deepEqual(result, { currentVersion: "0.1.0", published: false, available: false });
});

test("returns only the exact desktop release asset", async () => {
	const result = await checkDesktopUpdate("0.1.0", {
		fetchImpl: async () => Response.json(latestRelease()),
	});
	assert.equal(result.available, true);
	assert.equal(result.latestVersion, "0.1.1");
	assert.equal(result.releaseUrl, "https://github.com/s1oopX/pi-studio-dev/releases/tag/v0.1.1");
	assert.equal(
		result.downloadUrl,
		"https://github.com/s1oopX/pi-studio-dev/releases/download/v0.1.1/PiStudio-Dev-0.1.1.exe",
	);

	const missingAsset = await checkDesktopUpdate("0.1.0", {
		fetchImpl: async () => Response.json(latestRelease({ assets: [] })),
	});
	assert.equal(missingAsset.available, true);
	assert.equal(missingAsset.downloadUrl, null);
});

test("rejects release and desktop asset URLs outside the configured repository", async () => {

	for (const html_url of [
		"https://example.com/v0.1.1",
		"https://attacker@github.com/s1oopX/pi-studio-dev/releases/tag/v0.1.1",
	]) {
		await assert.rejects(
			checkDesktopUpdate("0.1.0", {
				fetchImpl: async () => Response.json(latestRelease({ html_url })),
			}),
			/unexpected release URL/,
		);
	}

	for (const browser_download_url of [
		"https://example.com/PiStudio-Dev-0.1.1.exe",
		"https://attacker@github.com/s1oopX/pi-studio-dev/releases/download/v0.1.1/PiStudio-Dev-0.1.1.exe",
		"https://github.com:444/s1oopX/pi-studio-dev/releases/download/v0.1.1/PiStudio-Dev-0.1.1.exe",
		"https://github.com/s1oopX/pi-studio-dev/releases/download/v0.1.2/PiStudio-Dev-0.1.1.exe",
		"https://github.com/s1oopX/pi-studio-dev/releases/download/v0.1.1/PiStudio-Dev-0.1.0.exe",
	]) {
		await assert.rejects(
			checkDesktopUpdate("0.1.0", {
				fetchImpl: async () =>
					Response.json(latestRelease({
						assets: [{ name: "PiStudio-Dev-0.1.1.exe", browser_download_url }],
					})),
			}),
			/unexpected desktop download URL/,
		);
	}
});
