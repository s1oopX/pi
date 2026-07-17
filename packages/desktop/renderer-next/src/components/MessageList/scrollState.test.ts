import { describe, expect, it } from "vitest";
import { isMessageListNearBottom } from "./scrollState";

describe("message list scroll state", () => {
  it("distinguishes reading history from following the latest message", () => {
    expect(isMessageListNearBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 400 })).toBe(false);
    expect(isMessageListNearBottom({ scrollHeight: 1000, scrollTop: 510, clientHeight: 400 })).toBe(true);
    expect(isMessageListNearBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 })).toBe(true);
  });
});
