import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildComputerUseScript,
	normalizeComputerKey,
	parseComputerUseScreenshot,
} from "../src/computer-use.ts";

describe("computer use", () => {
	it("normalizes supported key chords and rejects unsafe input", () => {
		assert.equal(normalizeComputerKey("ctrl+shift+l"), "^+l");
		assert.equal(normalizeComputerKey("enter"), "{ENTER}");
		assert.throws(() => normalizeComputerKey("win+r"), /Unsupported key modifier/);
		assert.throws(() => normalizeComputerKey("CTRL+rm -rf"), /Unsupported key/);
	});

	it("builds bounded relative-coordinate actions without interpolating typed text", () => {
		const click = buildComputerUseScript({ action: "click", x: 12, y: 34 });
		assert.match(click, /\$bounds\.Left \+ 12/);
		assert.match(click, /\$bounds\.Top \+ 34/);

		const typed = buildComputerUseScript({ action: "type", text: "secret ${not-powershell}" });
		assert.doesNotMatch(typed, /secret \$\{not-powershell\}/);
		assert.match(typed, /FromBase64String/);
	});

	it("validates the screenshot returned by PowerShell", () => {
		assert.deepEqual(
			parseComputerUseScreenshot(JSON.stringify({ x: -1920, y: 0, width: 3840, height: 1080, data: "aGVsbG8=" })),
			{ x: -1920, y: 0, width: 3840, height: 1080, data: "aGVsbG8=" },
		);
		assert.throws(() => parseComputerUseScreenshot("{}"), /invalid screenshot/);
	});
});
