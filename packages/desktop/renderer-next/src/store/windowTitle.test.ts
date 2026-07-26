import { describe, expect, it } from "vitest";
import { composeWindowTitle } from "./windowTitle";

describe("composeWindowTitle", () => {
  it("prefers the extension title verbatim", () => {
    expect(
      composeWindowTitle({
        extensionTitle: "Custom",
        sessionName: "Fix bug",
        workspaceCwd: "C:\\repos\\app",
        appName: "Pi Studio",
      }),
    ).toBe("Custom");
  });

  it("uses the session name, then the workspace folder, then the app name", () => {
    expect(
      composeWindowTitle({
        extensionTitle: null,
        sessionName: "Fix login bug",
        workspaceCwd: "C:\\repos\\app",
        appName: "Pi Studio",
      }),
    ).toBe("Fix login bug — Pi Studio");
    expect(
      composeWindowTitle({ extensionTitle: null, sessionName: "  ", workspaceCwd: "C:\\repos\\app", appName: "Pi Studio" }),
    ).toBe("app — Pi Studio");
    expect(
      composeWindowTitle({ extensionTitle: null, sessionName: undefined, workspaceCwd: "", appName: "Pi Studio" }),
    ).toBe("Pi Studio");
  });
});
