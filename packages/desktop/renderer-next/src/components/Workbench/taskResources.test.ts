import { describe, expect, it } from "vitest";
import type { Message, ToolCall } from "../../ipc/types";
import { collectTaskArtifacts, collectTaskSources } from "./taskResources";

function assistant(...content: Array<ToolCall | { type: "text"; text: string }>): Message {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "faux",
    model: "faux-1",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1,
  };
}

function toolCall(id: string, name: string, path: string): ToolCall {
  return { type: "toolCall", id, name, arguments: { path } };
}

function generatedImageResult(path: string, isError = false): Message {
  return {
    role: "toolResult",
    toolCallId: "image-1",
    toolName: "generate_image",
    content: [],
    details: { path },
    isError,
    timestamp: 2,
  };
}

describe("task resources", () => {
  it("keeps safe unique HTTP sources with useful labels", () => {
    expect(collectTaskSources([
      assistant({
        type: "text",
        text: "See [OpenAI docs](https://developers.openai.com/codex/) and https://developers.openai.com/codex/. Ignore https://user:secret@example.com/private.",
      }),
    ])).toEqual([{ label: "OpenAI docs", url: "https://developers.openai.com/codex/" }]);
  });

  it("collects and de-duplicates produced and linked files", () => {
    expect(collectTaskArtifacts([
      assistant(toolCall("write", "write", "reports/final.md")),
      assistant(
        toolCall("edit", "edit", "reports\\final.md"),
        { type: "text", text: "Built [installer](<D:/build/Pi Studio.exe>) and [source](reports/final.md:12)." },
      ),
    ])).toEqual([
      { label: "installer", operation: "referenced", path: "D:/build/Pi Studio.exe" },
      { label: "final.md", operation: "created", path: "reports/final.md" },
    ]);
  });

  it("collects generated image paths from tool results", () => {
    expect(collectTaskArtifacts([
      generatedImageResult("generated/failed.png", true),
      generatedImageResult("generated\\image.png"),
      assistant({ type: "text", text: "Done: [image](generated/image.png)" }),
    ])).toEqual([{ label: "image.png", operation: "created", path: "generated/image.png" }]);
  });
});
