import { describe, expect, it } from "vitest";
import { formatAgentLiveStatus } from "./agentLiveStatus";

describe("formatAgentLiveStatus", () => {
  it("is hidden when idle", () => {
    expect(formatAgentLiveStatus({
      isStreaming: false,
      elapsedSeconds: 0,
    }).visible).toBe(false);
  });

  it("shows Working… while streaming without a tool", () => {
    const status = formatAgentLiveStatus({
      isStreaming: true,
      elapsedSeconds: 0,
    });
    expect(status.visible).toBe(true);
    expect(status.tone).toBe("working");
    expect(status.primary).toBe("Working…");
    expect(status.line).toBe("Working…");
    expect(status.elapsed).toBeUndefined();
  });

  it("appends elapsed time after the first second", () => {
    const status = formatAgentLiveStatus({
      isStreaming: true,
      elapsedSeconds: 12,
    });
    expect(status.elapsed).toBe("12s");
    expect(status.line).toBe("Working… · 12s");
  });

  it("formats multi-minute elapsed", () => {
    const status = formatAgentLiveStatus({
      isStreaming: true,
      elapsedSeconds: 75,
    });
    expect(status.elapsed).toBe("1m 15s");
    expect(status.line).toContain("1m 15s");
  });

  it("prefers the active tool over plain Working", () => {
    const status = formatAgentLiveStatus({
      isStreaming: true,
      elapsedSeconds: 3,
      activeTool: "bash",
    });
    expect(status.tone).toBe("tool");
    expect(status.primary).toBe("Running bash");
    expect(status.line).toBe("Running bash · 3s");
  });

  it("humanizes tool names", () => {
    const status = formatAgentLiveStatus({
      isStreaming: true,
      elapsedSeconds: 0,
      activeTool: "fetch_remote-data",
    });
    expect(status.primary).toBe("Running fetch remote data");
  });

  it("compacting overrides streaming tool display", () => {
    const status = formatAgentLiveStatus({
      isStreaming: true,
      elapsedSeconds: 9,
      activeTool: "bash",
      isCompacting: true,
      compactionReason: "threshold",
    });
    expect(status.tone).toBe("compacting");
    expect(status.primary).toBe("Auto-compacting context");
    expect(status.line).toBe("Auto-compacting context");
    expect(status.elapsed).toBeUndefined();
  });

  it("localizes Chinese labels", () => {
    const working = formatAgentLiveStatus({
      isStreaming: true,
      elapsedSeconds: 5,
      language: "zh-CN",
    });
    expect(working.primary).toBe("正在处理…");
    expect(working.elapsed).toBe("5 秒");
    expect(working.line).toBe("正在处理… · 5 秒");

    const tool = formatAgentLiveStatus({
      isStreaming: true,
      elapsedSeconds: 0,
      activeTool: "read",
      language: "zh-CN",
    });
    expect(tool.primary).toBe("正在运行 read");
  });
});
