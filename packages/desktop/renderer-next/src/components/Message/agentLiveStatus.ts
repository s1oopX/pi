/**
 * Codex-style live strip on the active assistant turn:
 * "Working · 12s · bash" / "Compacting context" / plain "Working…".
 */

export type CompactionReason = "threshold" | "overflow" | "manual" | string;

export interface AgentLiveStatusInput {
  isStreaming: boolean;
  elapsedSeconds: number;
  activeTool?: string | null;
  isCompacting?: boolean;
  compactionReason?: CompactionReason | null;
  /** Number of tool calls completed or in-flight this turn. */
  stepCount?: number;
  /** Optional language for labels; defaults to English keys consumers re-translate. */
  language?: "en" | "zh-CN";
}

export interface AgentLiveStatus {
  /** Whether the live strip should render. */
  visible: boolean;
  /** Primary status phrase (e.g. Working… / Running bash / Compacting…). */
  primary: string;
  /** Elapsed time label when streaming and not compacting; otherwise undefined. */
  elapsed?: string;
  /** Step count label (e.g. "3 steps") when tools have been invoked. */
  steps?: string;
  /** Secondary detail (tool name already folded into primary when present). */
  tone: "working" | "tool" | "compacting";
  /** Full single-line label for aria / simple consumers. */
  line: string;
}

function formatElapsed(seconds: number, language: "en" | "zh-CN"): string | undefined {
  if (seconds <= 0) return undefined;
  if (seconds < 60) {
    return language === "zh-CN" ? `${seconds} 秒` : `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return language === "zh-CN" ? `${minutes} 分 ${rem} 秒` : `${minutes}m ${rem}s`;
}

function humanizeTool(tool: string): string {
  const text = tool.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
  if (!text) return tool;
  return text;
}

function compactingPrimary(reason: CompactionReason | null | undefined, language: "en" | "zh-CN"): string {
  if (reason === "threshold") {
    return language === "zh-CN" ? "正在自动压缩上下文" : "Auto-compacting context";
  }
  if (reason === "overflow") {
    return language === "zh-CN" ? "正在恢复上下文" : "Recovering context";
  }
  return language === "zh-CN" ? "正在压缩上下文" : "Compacting context";
}

function formatSteps(count: number | undefined, language: "en" | "zh-CN"): string | undefined {
  if (!count || count <= 0) return undefined;
  return language === "zh-CN" ? `${count} 步` : `${count} steps`;
}

/**
 * Build the live status model for the streaming assistant turn tail.
 * Not streaming and not compacting → not visible.
 */
export function formatAgentLiveStatus(input: AgentLiveStatusInput): AgentLiveStatus {
  const language = input.language ?? "en";
  const compacting = Boolean(input.isCompacting);
  const streaming = Boolean(input.isStreaming);
  const steps = formatSteps(input.stepCount, language);

  if (!streaming && !compacting) {
    return {
      visible: false,
      primary: "",
      tone: "working",
      line: "",
    };
  }

  if (compacting) {
    const primary = compactingPrimary(input.compactionReason, language);
    return {
      visible: true,
      primary,
      steps,
      tone: "compacting",
      line: primary,
    };
  }

  const tool = input.activeTool?.trim();
  if (tool) {
    const label = humanizeTool(tool);
    const primary = language === "zh-CN" ? `正在运行 ${label}` : `Running ${label}`;
    const elapsed = formatElapsed(input.elapsedSeconds, language);
    const line = elapsed ? `${primary} · ${elapsed}` : primary;
    return {
      visible: true,
      primary,
      elapsed,
      steps,
      tone: "tool",
      line,
    };
  }

  const primary = language === "zh-CN" ? "正在处理…" : "Working…";
  const elapsed = formatElapsed(input.elapsedSeconds, language);
  const line = elapsed ? `${primary} · ${elapsed}` : primary;
  return {
    visible: true,
    primary,
    elapsed,
    steps,
    tone: "working",
    line,
  };
}
