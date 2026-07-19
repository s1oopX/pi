import { describe, expect, it } from "vitest";
import {
  buildCustomModelInput,
  createModelConfigBackup,
  getConnectionTestFailure,
  hasPermissionModeExtension,
  readModelConfigBackupProviders,
} from "./settingsLogic";

describe("settings logic", () => {
  it("builds explicit custom model input capabilities", () => {
    expect(buildCustomModelInput(false)).toEqual(["text"]);
    expect(buildCustomModelInput(true)).toEqual(["text", "image"]);
  });

  it("treats backend connection failures as failures", () => {
    expect(getConnectionTestFailure({ ok: true, latencyMs: 12 })).toBeNull();
    expect(getConnectionTestFailure({ ok: false, category: "auth", message: "Invalid API key" })).toBe(
      "Invalid API key (auth)",
    );
    expect(getConnectionTestFailure(null)).toBe("The backend returned an invalid connection test response");
    expect(getConnectionTestFailure(null, "zh-CN")).toBe("后端返回了无效的连接测试响应");
    expect(getConnectionTestFailure({ ok: false }, "zh-CN")).toBe("连接测试失败");
  });

  it("creates and validates model configuration backups", () => {
    const providers = { local: { baseUrl: "http://localhost:11434/v1" } };
    const backup = createModelConfigBackup(providers);

    expect(backup).toEqual({ format: "pi-studio-models", version: 1, providers });
    expect(readModelConfigBackupProviders(backup)).toBe(providers);
    expect(readModelConfigBackupProviders({ ...backup, version: 2 })).toBeNull();
    expect(readModelConfigBackupProviders({ ...backup, providers: [] })).toBeNull();
  });

  it("detects permission-mode via registered flags, with path fallback", () => {
    expect(
      hasPermissionModeExtension({
        extensionFlags: [{ name: "permission-mode" }],
      }),
    ).toBe(true);
    expect(
      hasPermissionModeExtension({
        extensions: [{ name: "C:\\Users\\me\\.pi\\agent\\extensions\\tool-approval.ts" }],
      }),
    ).toBe(true);
    expect(
      hasPermissionModeExtension({
        extensions: [{ path: "/home/me/.pi/agent/extensions/tool-approval.js" }],
      }),
    ).toBe(true);
    expect(
      hasPermissionModeExtension({
        extensions: [{ name: "ssh.ts" }, { path: "preset.ts" }],
      }),
    ).toBe(false);
    expect(hasPermissionModeExtension(null)).toBe(false);
  });
});
