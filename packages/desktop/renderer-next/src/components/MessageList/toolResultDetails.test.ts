import { describe, expect, it } from "vitest";
import { extractPatchFromToolDetails } from "./toolResultDetails";

describe("extractPatchFromToolDetails", () => {
  it("prefers details.patch when it looks like a unified diff", () => {
    const patch = "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n";
    expect(extractPatchFromToolDetails({ patch, diff: "display only" })).toBe(patch);
  });

  it("falls back to details.diff when it is unified", () => {
    const diff = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n";
    expect(extractPatchFromToolDetails({ diff })).toBe(diff);
  });

  it("returns undefined for missing or non-diff details", () => {
    expect(extractPatchFromToolDetails(undefined)).toBeUndefined();
    expect(extractPatchFromToolDetails({ patch: "not a diff" })).toBeUndefined();
    expect(extractPatchFromToolDetails({ foo: 1 })).toBeUndefined();
  });
});
