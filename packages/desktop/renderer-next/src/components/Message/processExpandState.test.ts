import { describe, expect, it } from "vitest";
import {
  createProcessExpandState,
  reduceProcessExpandState,
  resolveFileChangeDefaultOpen,
} from "./processExpandState";

describe("reduceProcessExpandState", () => {
  it("thinking opens on stream-start and closes on stream-end", () => {
    let state = createProcessExpandState(false);
    state = reduceProcessExpandState(state, { type: "stream-start" }, "thinking");
    expect(state.open).toBe(true);
    state = reduceProcessExpandState(state, { type: "stream-end" }, "thinking");
    expect(state.open).toBe(false);
    expect(state.userLocked).toBe(false);
  });

  it("user toggle locks thinking against later stream-end", () => {
    let state = createProcessExpandState(true);
    state = reduceProcessExpandState(state, { type: "user-toggle" }, "thinking");
    expect(state.open).toBe(false);
    expect(state.userLocked).toBe(true);
    state = reduceProcessExpandState(state, { type: "stream-end" }, "thinking");
    expect(state.open).toBe(false);
    state = reduceProcessExpandState(state, { type: "stream-start" }, "thinking");
    expect(state.open).toBe(false);
  });

  it("tool/file rows open on phase-error unless user locked", () => {
    let tool = createProcessExpandState(false);
    tool = reduceProcessExpandState(tool, { type: "phase-error" }, "tool");
    expect(tool.open).toBe(true);

    let locked = createProcessExpandState(false);
    locked = reduceProcessExpandState(locked, { type: "user-toggle" }, "tool");
    locked = reduceProcessExpandState(locked, { type: "phase-error" }, "tool");
    // user-toggle opened it; phase-error must not fight a locked closed state either
    locked = createProcessExpandState(false);
    locked = reduceProcessExpandState(locked, { type: "user-toggle" }, "tool"); // open + locked
    locked = reduceProcessExpandState(locked, { type: "user-toggle" }, "tool"); // closed + locked
    locked = reduceProcessExpandState(locked, { type: "phase-error" }, "tool");
    expect(locked.open).toBe(false);
    expect(locked.userLocked).toBe(true);
  });

  it("ignores stream events for tool policy", () => {
    let state = createProcessExpandState(false);
    state = reduceProcessExpandState(state, { type: "stream-start" }, "tool");
    expect(state.open).toBe(false);
  });
});

describe("resolveFileChangeDefaultOpen", () => {
  it("opens single-file groups and errors by default", () => {
    expect(resolveFileChangeDefaultOpen({ fileCount: 1, phase: "done" })).toBe(true);
    expect(resolveFileChangeDefaultOpen({ fileCount: 3, phase: "error" })).toBe(true);
    expect(resolveFileChangeDefaultOpen({ fileCount: 3, phase: "done" })).toBe(false);
  });
});
