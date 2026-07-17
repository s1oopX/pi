import { describe, expect, it } from "vitest";
import { isBackendEventCurrent } from "./events";

describe("backend event workspace guard", () => {
  it("accepts only events from the current workspace", () => {
    expect(isBackendEventCurrent("C:\\Code\\Pi", "c:/code/pi/")).toBe(true);
    expect(isBackendEventCurrent("C:\\Code\\Other", "C:\\Code\\Pi")).toBe(false);
    expect(isBackendEventCurrent("", "C:\\Code\\Pi")).toBe(false);
    expect(isBackendEventCurrent("C:\\Code\\Pi", "")).toBe(false);
  });
});
