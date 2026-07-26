import { describe, expect, it } from "vitest";
import { createBashExecutionId, emitBashExecutionDelta, subscribeBashExecution } from "./bashExecutionStream";

describe("bash execution stream", () => {
  it("delivers deltas to the matching subscriber only", () => {
    const received: string[] = [];
    const other: string[] = [];
    const unsubscribe = subscribeBashExecution("bash_a", (delta) => received.push(delta));
    const unsubscribeOther = subscribeBashExecution("bash_b", (delta) => other.push(delta));

    emitBashExecutionDelta("bash_a", "one");
    emitBashExecutionDelta("bash_a", "two");
    emitBashExecutionDelta("bash_unknown", "ignored");

    expect(received).toEqual(["one", "two"]);
    expect(other).toEqual([]);
    unsubscribe();
    unsubscribeOther();
  });

  it("stops delivering after unsubscribe", () => {
    const received: string[] = [];
    const unsubscribe = subscribeBashExecution("bash_c", (delta) => received.push(delta));
    emitBashExecutionDelta("bash_c", "one");
    unsubscribe();
    emitBashExecutionDelta("bash_c", "two");
    expect(received).toEqual(["one"]);
  });

  it("creates unique ids with a bash prefix", () => {
    const first = createBashExecutionId();
    const second = createBashExecutionId();
    expect(first).toMatch(/^bash_/);
    expect(first).not.toBe(second);
  });
});
