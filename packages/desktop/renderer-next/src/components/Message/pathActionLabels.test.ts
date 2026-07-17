import { describe, expect, it } from "vitest";
import {
  pathActionCopyLabel,
  pathActionRevealLabel,
  pathCopiedToast,
  pathRevealFailedToast,
} from "./pathActionLabels";

describe("pathActions labels", () => {
  it("localizes copy/reveal labels and toasts", () => {
    expect(pathActionCopyLabel("en")).toBe("Copy path");
    expect(pathActionRevealLabel("en")).toBe("Reveal in Explorer");
    expect(pathCopiedToast("zh-CN")).toBe("路径已复制");
    expect(pathRevealFailedToast("zh-CN")).toBe("无法打开路径");
  });
});
