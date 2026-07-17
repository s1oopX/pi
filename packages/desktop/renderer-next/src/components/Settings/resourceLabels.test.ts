import { describe, expect, it } from "vitest";
import { getResourceSourceLabel } from "./resourceLabels";

describe("resource source labels", () => {
  it("localizes built-in source names", () => {
    expect(getResourceSourceLabel("local", "zh-CN")).toBe("本地");
    expect(getResourceSourceLabel("auto", "zh-CN")).toBe("自动发现");
    expect(getResourceSourceLabel("cli", "en")).toBe("command line");
  });

  it("preserves package and extension-defined source names", () => {
    expect(getResourceSourceLabel("npm:@scope/tools", "zh-CN")).toBe("npm:@scope/tools");
  });
});
