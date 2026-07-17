import { describe, expect, it } from "vitest";
import type { Message, ToolCall } from "../../ipc/types";
import type { ToolExecutionsByCallId } from "../../store";
import {
  describeToolCall,
  formatDisplayPath,
  resolveToolPhase,
  serializeToolInput,
  toolPhaseLabel,
} from "./toolPresentation";

function call(name: string, args: Record<string, unknown>, id = "call-1"): ToolCall {
  return { type: "toolCall", id, name, arguments: args };
}

function result(isError: boolean): Extract<Message, { role: "toolResult" }> {
  return {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "read",
    content: [{ type: "text", text: isError ? "failed" : "ok" }],
    isError,
    timestamp: 1,
  };
}

describe("formatDisplayPath", () => {
  it("keeps short paths and shortens deep absolute-style paths", () => {
    expect(formatDisplayPath("src/App.tsx")).toBe("src/App.tsx");
    expect(formatDisplayPath("C:\\Users\\me\\project\\packages\\desktop\\renderer-next\\src\\components\\Message\\MessageBubble.tsx"))
      .toMatch(/MessageBubble\.tsx$/);
    expect(formatDisplayPath("C:\\Users\\me\\project\\packages\\desktop\\renderer-next\\src\\components\\Message\\MessageBubble.tsx"))
      .toMatch(/^…\//);
  });
});

describe("describeToolCall", () => {
  it("describes all built-in tools from their real argument shapes", () => {
    expect(describeToolCall(call("read", { path: "src/App.tsx", offset: 4, limit: 3 }), "running"))
      .toMatchObject({ action: "Reading", subject: "src/App.tsx", meta: "lines 4–6" });
    expect(describeToolCall(call("write", { path: "a.ts", content: "a\nb" }), "done"))
      .toMatchObject({ action: "Wrote", subject: "a.ts", meta: "2 lines · 3 chars" });
    expect(describeToolCall(call("edit", { path: "a.ts", edits: [{}, {}] }), "done"))
      .toMatchObject({ action: "Edited", subject: "a.ts", meta: "2 replacements" });
    expect(describeToolCall(call("bash", { command: "npm run check\necho done", timeout: 30 }), "error"))
      .toMatchObject({ action: "Command failed", subject: "npm run check", meta: "timeout 30s" });
    expect(describeToolCall(call("grep", { pattern: "TODO", path: "src", glob: "*.ts" }), "done"))
      .toMatchObject({ action: "Searched", subject: "“TODO” in src", meta: "*.ts" });
    expect(describeToolCall(call("find", { pattern: "**/*.test.ts", path: "src" }), "queued"))
      .toMatchObject({ action: "Waiting to find", subject: "**/*.test.ts in src" });
    expect(describeToolCall(call("ls", {}), "done"))
      .toMatchObject({ action: "Listed", subject: "." });
    expect(describeToolCall(call("read", {
      path: "packages/desktop/renderer-next/src/components/Message/MessageBubble.tsx",
    }), "done").subject).toMatch(/MessageBubble\.tsx$/);
  });

  it("humanizes unknown tools and uses a safe common subject", () => {
    expect(describeToolCall(call("fetch_remote-data", { query: "releases" }), "running"))
      .toMatchObject({ action: "Running Fetch remote data", subject: "releases" });
  });

  it("compacts mutation payloads instead of serializing file contents", () => {
    const presentation = describeToolCall(call("write", { path: "a.ts", content: "secret source" }), "done");
    expect(presentation.inputText).toContain("[13 chars, 1 lines]");
    expect(presentation.inputText).not.toContain("secret source");
  });

  it("localizes application metadata without changing technical subjects", () => {
    expect(describeToolCall(call("read", { path: "src/App.tsx", offset: 4, limit: 3 }), "running", "zh-CN"))
      .toMatchObject({ action: "正在读取", subject: "src/App.tsx", meta: "第 4–6 行" });
    expect(describeToolCall(call("bash", { command: "npm run check", timeout: 30 }), "error", "zh-CN"))
      .toMatchObject({ action: "命令失败", subject: "npm run check", meta: "超时 30 秒" });
    expect(describeToolCall(call("write", { path: "a.ts", content: "a\nb" }), "done", "zh-CN"))
      .toMatchObject({ meta: "2 行 · 3 个字符" });
    expect(describeToolCall(call("write", { path: "a.ts", content: "a\nb" }), "done", "zh-CN").inputText)
      .toContain("[3 个字符，2 行]");
    expect(toolPhaseLabel("queued", "zh-CN")).toBe("已排队");
  });
});

describe("serializeToolInput", () => {
  it("recursively redacts sensitive keys without hiding ordinary token counts", () => {
    const serialized = serializeToolInput({
      apiKey: "one",
      nested: { access_token: "two", maxTokens: 100 },
      rows: [{ password: "three", github_token: "four" }],
    });
    expect(serialized).not.toContain("one");
    expect(serialized).not.toContain("two");
    expect(serialized).not.toContain("three");
    expect(serialized).not.toContain("four");
    expect(serialized.match(/\[redacted\]/g)).toHaveLength(4);
    expect(serialized).toContain('"maxTokens": 100');
  });

  it("limits the complete serialized output length", () => {
    const serialized = serializeToolInput({ value: "x".repeat(1_000) }, 120);
    expect(serialized.length).toBeLessThanOrEqual(120);
    expect(serialized).toContain("truncated");
  });
});

describe("resolveToolPhase", () => {
  const executions: ToolExecutionsByCallId = {
    "call-1": { toolName: "read", phase: "running" },
    "call-2": { toolName: "write", phase: "queued" },
  };

  it("uses result error and success before transient execution state", () => {
    expect(resolveToolPhase("call-1", result(true), executions, true)).toBe("error");
    expect(resolveToolPhase("call-1", result(false), executions, true)).toBe("done");
  });

  it("falls back through execution, streaming queue, and unknown", () => {
    expect(resolveToolPhase("call-1", undefined, executions, true)).toBe("running");
    expect(resolveToolPhase("call-2", undefined, executions, false)).toBe("queued");
    expect(resolveToolPhase("call-3", undefined, executions, true)).toBe("queued");
    expect(resolveToolPhase("call-3", undefined, executions, false)).toBe("unknown");
  });
});
