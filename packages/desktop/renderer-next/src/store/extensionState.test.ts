import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from ".";

describe("extension UI state", () => {
  beforeEach(() => {
    useStore.setState({
      extensionStatuses: {},
      extensionWidgets: [],
      extensionTitle: null,
    });
  });

  it("updates and clears keyed extension statuses", () => {
    const store = useStore.getState();
    store.setExtensionStatus("deploy", "Uploading");
    store.setExtensionStatus("tests", "Running");
    store.setExtensionStatus("deploy", undefined);

    expect(useStore.getState().extensionStatuses).toEqual({ tests: "Running" });
  });

  it("keeps widget insertion order across updates and supports explicit removal", () => {
    const store = useStore.getState();
    store.setExtensionWidget("first", ["one"], "aboveEditor");
    store.setExtensionWidget("second", ["two"], "belowEditor");
    const firstOrder = useStore.getState().extensionWidgets[0]?.order;
    store.setExtensionWidget("first", ["updated"], "belowEditor");

    expect(useStore.getState().extensionWidgets).toEqual([
      { key: "first", lines: ["updated"], placement: "belowEditor", order: firstOrder },
      { key: "second", lines: ["two"], placement: "belowEditor", order: (firstOrder ?? -1) + 1 },
    ]);

    store.setExtensionWidget("first", undefined, "aboveEditor");
    expect(useStore.getState().extensionWidgets.map(({ key }) => key)).toEqual(["second"]);
  });

  it("clears extension-owned state on a workspace reset", () => {
    const store = useStore.getState();
    store.setExtensionStatus("task", "Running");
    store.setExtensionWidget("task", ["line"], "aboveEditor");
    store.setExtensionTitle("Extension title");

    store.resetForWorkspace("C:\\next");

    expect(useStore.getState()).toMatchObject({
      extensionStatuses: {},
      extensionWidgets: [],
      extensionTitle: null,
    });
  });
});
