import { describe, expect, it } from "vitest";
import {
  createCommandHistoryState,
  pushCommand,
  recallNext,
  recallPrevious,
} from "./commandHistory";

describe("commandHistory", () => {
  it("starts empty and idle", () => {
    const state = createCommandHistoryState();
    expect(state.entries).toEqual([]);
    expect(state.cursor).toBeNull();
    expect(state.draft).toBe("");
  });

  it("records submitted commands oldest-first", () => {
    let state = createCommandHistoryState();
    state = pushCommand(state, "one");
    state = pushCommand(state, "two");
    expect(state.entries).toEqual(["one", "two"]);
    expect(state.cursor).toBeNull();
  });

  it("ignores blank commands", () => {
    let state = createCommandHistoryState();
    state = pushCommand(state, "   ");
    expect(state.entries).toEqual([]);
  });

  it("collapses consecutive duplicates", () => {
    let state = createCommandHistoryState();
    state = pushCommand(state, "ls");
    state = pushCommand(state, "ls");
    expect(state.entries).toEqual(["ls"]);
  });

  it("keeps non-consecutive repeats", () => {
    let state = createCommandHistoryState();
    state = pushCommand(state, "ls");
    state = pushCommand(state, "cd");
    state = pushCommand(state, "ls");
    expect(state.entries).toEqual(["ls", "cd", "ls"]);
  });

  it("recallPrevious does nothing with empty history", () => {
    const state = createCommandHistoryState();
    const recall = recallPrevious(state, "draft");
    expect(recall.value).toBeNull();
    expect(recall.state).toBe(state);
  });

  it("recallPrevious walks toward older entries, stashing the draft", () => {
    let state = createCommandHistoryState();
    state = pushCommand(state, "first");
    state = pushCommand(state, "second");

    const up1 = recallPrevious(state, "live draft");
    expect(up1.value).toBe("second");
    expect(up1.state.draft).toBe("live draft");

    const up2 = recallPrevious(up1.state, "second");
    expect(up2.value).toBe("first");

    // At the oldest entry, further Up stays put.
    const up3 = recallPrevious(up2.state, "first");
    expect(up3.value).toBeNull();
  });

  it("recallNext returns toward the live draft and exits recall", () => {
    let state = createCommandHistoryState();
    state = pushCommand(state, "first");
    state = pushCommand(state, "second");

    const up1 = recallPrevious(state, "my draft");
    const up2 = recallPrevious(up1.state, "second");
    // up2 is at "first"; Down moves to "second".
    const down1 = recallNext(up2.state);
    expect(down1.value).toBe("second");
    // Down past the newest restores the stashed draft and exits recall.
    const down2 = recallNext(down1.state);
    expect(down2.value).toBe("my draft");
    expect(down2.state.cursor).toBeNull();
  });

  it("recallNext does nothing when not recalling", () => {
    let state = createCommandHistoryState();
    state = pushCommand(state, "cmd");
    const recall = recallNext(state);
    expect(recall.value).toBeNull();
    expect(recall.state).toBe(state);
  });

  it("submitting resets recall to the draft", () => {
    let state = createCommandHistoryState();
    state = pushCommand(state, "a");
    const up = recallPrevious(state, "");
    expect(up.state.cursor).not.toBeNull();
    const afterSubmit = pushCommand(up.state, "b");
    expect(afterSubmit.cursor).toBeNull();
    expect(afterSubmit.entries).toEqual(["a", "b"]);
  });

  it("caps history at the maximum length", () => {
    let state = createCommandHistoryState();
    for (let i = 0; i < 150; i++) {
      state = pushCommand(state, `cmd-${i}`);
    }
    expect(state.entries.length).toBe(100);
    expect(state.entries[0]).toBe("cmd-50");
    expect(state.entries[state.entries.length - 1]).toBe("cmd-149");
  });
});
