import { describe, expect, it } from "vitest";
import {
	buildEditPreviewPatch,
	buildMutationPreviewPatch,
	buildWritePreviewPatch,
	looksLikeUnifiedDiff,
} from "./mutationPreview";

describe("mutationPreview", () => {
	it("builds a write preview with all lines added", () => {
		const patch = buildWritePreviewPatch("src/a.ts", "const x = 1;\n");
		expect(patch).toContain("--- /dev/null");
		expect(patch).toContain("+++ b/src/a.ts");
		expect(patch).toContain("+const x = 1;");
		expect(looksLikeUnifiedDiff(patch)).toBe(true);
	});

	it("builds edit previews from edits[] and legacy oldText/newText", () => {
		const fromArray = buildEditPreviewPatch("src/a.ts", {
			edits: [{ oldText: "foo", newText: "bar" }],
		});
		expect(fromArray).toContain("--- a/src/a.ts");
		expect(fromArray).toContain("-foo");
		expect(fromArray).toContain("+bar");

		const legacy = buildEditPreviewPatch("src/a.ts", {
			oldText: "old",
			newText: "new",
		});
		expect(legacy).toContain("-old");
		expect(legacy).toContain("+new");
	});

	it("routes write/edit through buildMutationPreviewPatch", () => {
		expect(buildMutationPreviewPatch("write", "a.ts", { content: "x" })).toContain("+x");
		expect(buildMutationPreviewPatch("edit", "a.ts", {
			edits: [{ oldText: "a", newText: "b" }],
		})).toContain("-a");
		expect(buildMutationPreviewPatch("write", "a.ts", {})).toBeUndefined();
		expect(buildMutationPreviewPatch("edit", "a.ts", { edits: [] })).toBeUndefined();
	});

	it("truncates huge write content with a visible note", () => {
		const content = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
		const patch = buildWritePreviewPatch("big.ts", content);
		expect(patch).toContain("preview truncated");
		// Header lines + at most 200 content lines + truncation note.
		expect(patch.split("\n").length).toBeLessThan(220);
		expect(patch).not.toContain("line 499");
	});

	it("clips patch character budget", () => {
		const patch = buildWritePreviewPatch("big.ts", "x".repeat(20_000));
		expect(patch.length).toBeLessThanOrEqual(12_050);
		expect(patch.endsWith("…") || patch.includes("\n…")).toBe(true);
	});

	it("skips invalid edit entries and still builds from valid ones", () => {
		const patch = buildEditPreviewPatch("a.ts", {
			edits: [
				null,
				{ oldText: "only-old" },
				{ oldText: "a", newText: "b" },
			],
		});
		expect(patch).toContain("-a");
		expect(patch).toContain("+b");
		expect(patch).not.toContain("only-old");
	});
});
