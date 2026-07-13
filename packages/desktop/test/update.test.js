import assert from "node:assert/strict";
import test from "node:test";
import { checkDesktopUpdate, isNewerDesktopVersion } from "../src/update.js";

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

test("accepts only the configured repository release URL", async () => {
	const result = await checkDesktopUpdate("0.1.0", {
		fetchImpl: async () =>
			Response.json({
				tag_name: "v0.1.1",
				html_url: "https://github.com/s1oopX/pi/releases/tag/v0.1.1",
				draft: false,
				prerelease: false,
			}),
	});
	assert.equal(result.available, true);
	assert.equal(result.latestVersion, "0.1.1");
	assert.equal(result.releaseUrl, "https://github.com/s1oopX/pi/releases/tag/v0.1.1");

	await assert.rejects(
		checkDesktopUpdate("0.1.0", {
			fetchImpl: async () =>
				Response.json({
					tag_name: "v0.1.1",
					html_url: "https://example.com/PiStudio-0.1.1.exe",
					draft: false,
					prerelease: false,
				}),
		}),
		/unexpected release URL/,
	);
});
