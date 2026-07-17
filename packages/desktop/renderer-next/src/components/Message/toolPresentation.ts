import { translateText, type ResolvedLanguage, type TranslationValues } from "../../i18n";
import type { Message, ToolCall } from "../../ipc/types";
import type { ToolExecutionsByCallId } from "../../store";

export type ToolPhase = "queued" | "running" | "done" | "error" | "unknown";

type ToolResult = Extract<Message, { role: "toolResult" }>;

export interface ToolPresentation {
  action: string;
  subject?: string;
  meta?: string;
  inputText: string;
}

const SERIALIZED_INPUT_LIMIT = 6_000;
const SUMMARY_TEXT_LIMIT = 140;
const REDACTED = "[redacted]";

const SENSITIVE_KEY_SUFFIXES = [
  "apikey",
  "accesstoken",
  "refreshtoken",
  "authtoken",
  "token",
  "authorization",
  "password",
  "passwd",
  "secret",
  "secretkey",
  "privatekey",
  "credential",
  "cookie",
];

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function pathArg(args: Record<string, unknown>): string | undefined {
  return stringArg(args, "path") ?? stringArg(args, "file_path");
}

function compactSingleLine(value: string, limit = SUMMARY_TEXT_LIMIT): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

/** Short path for process-row subject (Codex-style scannable headers). */
export function formatDisplayPath(path: string, limit = 56): string {
  const normalized = path.replace(/\\/g, "/").trim();
  if (!normalized) return path;
  if (normalized.length <= limit) return normalized;

  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 1) return compactSingleLine(normalized, limit);

  const file = segments[segments.length - 1] ?? normalized;
  if (file.length >= limit - 2) return compactSingleLine(file, limit);

  // Keep basename + as many parent segments as fit: …/parent/file
  let display = file;
  for (let i = segments.length - 2; i >= 0; i -= 1) {
    const candidate = `${segments[i]}/${display}`;
    if (candidate.length + 1 > limit) break;
    display = candidate;
  }
  return display === normalized ? display : `…/${display}`;
}

function firstCommandLine(command: string): string {
  const firstLine = command.split(/\r?\n/).find((line) => line.trim());
  return compactSingleLine(firstLine ?? command);
}

function quote(value: string): string {
  return `“${compactSingleLine(value, 90)}”`;
}

function phaseAction(
  phase: ToolPhase,
  labels: { queued: string; running: string; done: string; error: string; unknown: string },
): string {
  return labels[phase];
}

function localize(
  language: ResolvedLanguage,
  english: string,
  simplifiedChinese: string,
  values?: TranslationValues,
): string {
  return translateText(language, english, simplifiedChinese, values);
}

function humanizeToolName(name: string): string {
  const text = name.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
  if (!text) return "Tool";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SENSITIVE_KEY_SUFFIXES.some((suffix) => normalized === suffix || normalized.endsWith(suffix));
}

function redactSensitiveValue(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    return value.map((item) => redactSensitiveValue(item, seen));
  }
  if (value !== null && typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      redacted[key] = isSensitiveKey(key) ? REDACTED : redactSensitiveValue(item, seen);
    }
    return redacted;
  }
  return value;
}

export function serializeToolInput(
  value: unknown,
  maxLength = SERIALIZED_INPUT_LIMIT,
  language: ResolvedLanguage = "en",
): string {
  const safeLimit = Math.max(0, maxLength);
  let serialized: string;
  try {
    serialized = JSON.stringify(redactSensitiveValue(value, new WeakSet()), null, 2) ?? "";
  } catch {
    serialized = localize(language, "[unable to serialize input]", "[无法序列化输入]");
  }
  if (serialized.length <= safeLimit) return serialized;
  const suffix = localize(
    language,
    "\n… truncated ({count} chars total)",
    "\n… 已截断（共 {count} 个字符）",
    { count: serialized.length },
  );
  if (suffix.length >= safeLimit) return suffix.slice(0, safeLimit);
  return `${serialized.slice(0, safeLimit - suffix.length)}${suffix}`;
}

function mutationInput(
  name: string,
  args: Record<string, unknown>,
  language: ResolvedLanguage,
): Record<string, unknown> {
  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === "content" || key === "edits" || key === "oldText" || key === "newText") continue;
    compact[key] = value;
  }

  if (name === "write") {
    const content = typeof args.content === "string" ? args.content : undefined;
    compact.content = content === undefined
      ? localize(language, "[invalid or missing content]", "[内容无效或缺失]")
      : localize(language, "[{chars} chars, {lines} lines]", "[{chars} 个字符，{lines} 行]", {
          chars: content.length,
          lines: content.split("\n").length,
        });
  } else {
    const edits = Array.isArray(args.edits)
      ? args.edits.length
      : typeof args.oldText === "string" && typeof args.newText === "string"
        ? 1
        : 0;
    compact.edits = localize(
      language,
      edits === 1 ? "[{count} replacement]" : "[{count} replacements]",
      "[{count} 处替换]",
      { count: edits },
    );
  }
  return compact;
}

function inputForDetails(call: ToolCall, language: ResolvedLanguage): unknown {
  if (call.name === "write" || call.name === "edit") {
    return mutationInput(call.name, call.arguments, language);
  }
  return call.arguments;
}

function mutationMeta(
  name: "write" | "edit",
  args: Record<string, unknown>,
  language: ResolvedLanguage,
): string | undefined {
  if (name === "write") {
    const content = typeof args.content === "string" ? args.content : undefined;
    if (content === undefined) return undefined;
    return localize(language, "{lines} lines · {chars} chars", "{lines} 行 · {chars} 个字符", {
      lines: content.split("\n").length,
      chars: content.length,
    });
  }
  const editCount = Array.isArray(args.edits)
    ? args.edits.length
    : typeof args.oldText === "string" && typeof args.newText === "string"
      ? 1
      : 0;
  if (editCount === 0) return undefined;
  return localize(
    language,
    editCount === 1 ? "{count} replacement" : "{count} replacements",
    "{count} 处替换",
    { count: editCount },
  );
}

export function describeToolCall(
  call: ToolCall,
  phase: ToolPhase,
  language: ResolvedLanguage = "en",
): ToolPresentation {
  const args = call.arguments;
  const path = pathArg(args);
  const displayPath = path ? formatDisplayPath(path) : undefined;
  let action: string;
  let subject: string | undefined;
  let meta: string | undefined;

  switch (call.name) {
    case "read": {
      action = phaseAction(phase, {
        queued: localize(language, "Waiting to read", "等待读取"),
        running: localize(language, "Reading", "正在读取"),
        done: localize(language, "Read", "已读取"),
        error: localize(language, "Failed to read", "读取失败"),
        unknown: localize(language, "Read", "读取"),
      });
      subject = displayPath;
      const offset = numberArg(args, "offset");
      const limit = numberArg(args, "limit");
      if (offset !== undefined && limit !== undefined) {
        meta = localize(language, "lines {start}–{end}", "第 {start}–{end} 行", {
          start: offset,
          end: offset + Math.max(0, limit - 1),
        });
      } else if (offset !== undefined) {
        meta = localize(language, "from line {line}", "从第 {line} 行开始", { line: offset });
      } else if (limit !== undefined) {
        meta = localize(language, "first {count} lines", "前 {count} 行", { count: limit });
      }
      break;
    }
    case "write":
    case "edit": {
      const isWrite = call.name === "write";
      action = phaseAction(phase, isWrite
        ? {
            queued: localize(language, "Waiting to write", "等待写入"),
            running: localize(language, "Writing", "正在写入"),
            done: localize(language, "Wrote", "已写入"),
            error: localize(language, "Failed to write", "写入失败"),
            unknown: localize(language, "Write", "写入"),
          }
        : {
            queued: localize(language, "Waiting to edit", "等待编辑"),
            running: localize(language, "Editing", "正在编辑"),
            done: localize(language, "Edited", "已编辑"),
            error: localize(language, "Failed to edit", "编辑失败"),
            unknown: localize(language, "Edit", "编辑"),
          });
      subject = displayPath;
      meta = mutationMeta(call.name, args, language);
      break;
    }
    case "bash": {
      action = phaseAction(phase, {
        queued: localize(language, "Waiting to run", "等待运行"),
        running: localize(language, "Running", "正在运行"),
        done: localize(language, "Ran", "已运行"),
        error: localize(language, "Command failed", "命令失败"),
        unknown: localize(language, "Command", "命令"),
      });
      const command = stringArg(args, "command");
      subject = command ? firstCommandLine(command) : undefined;
      const timeout = numberArg(args, "timeout");
      if (timeout !== undefined) {
        meta = localize(language, "timeout {seconds}s", "超时 {seconds} 秒", { seconds: timeout });
      }
      break;
    }
    case "grep": {
      action = phaseAction(phase, {
        queued: localize(language, "Waiting to search", "等待搜索"),
        running: localize(language, "Searching", "正在搜索"),
        done: localize(language, "Searched", "已搜索"),
        error: localize(language, "Search failed", "搜索失败"),
        unknown: localize(language, "Search", "搜索"),
      });
      const pattern = stringArg(args, "pattern");
      const target = displayPath ?? ".";
      subject = pattern
        ? localize(language, "{pattern} in {target}", "在 {target} 中搜索 {pattern}", {
            pattern: quote(pattern),
            target,
          })
        : target;
      meta = stringArg(args, "glob");
      break;
    }
    case "find": {
      action = phaseAction(phase, {
        queued: localize(language, "Waiting to find", "等待查找"),
        running: localize(language, "Finding", "正在查找"),
        done: localize(language, "Found", "已找到"),
        error: localize(language, "Find failed", "查找失败"),
        unknown: localize(language, "Find", "查找"),
      });
      const pattern = stringArg(args, "pattern");
      const target = displayPath ?? ".";
      subject = pattern
        ? localize(language, "{pattern} in {target}", "在 {target} 中查找 {pattern}", {
            pattern: compactSingleLine(pattern, 90),
            target,
          })
        : target;
      break;
    }
    case "ls": {
      action = phaseAction(phase, {
        queued: localize(language, "Waiting to list", "等待列出"),
        running: localize(language, "Listing", "正在列出"),
        done: localize(language, "Listed", "已列出"),
        error: localize(language, "Listing failed", "列出失败"),
        unknown: localize(language, "List", "列出"),
      });
      subject = displayPath ?? ".";
      break;
    }
    default: {
      const label = humanizeToolName(call.name);
      action = phase === "running"
        ? localize(language, "Running {tool}", "正在运行 {tool}", { tool: label })
        : phase === "error"
          ? localize(language, "{tool} failed", "{tool} 失败", { tool: label })
          : label;
      subject = displayPath
        ?? stringArg(args, "command")
        ?? stringArg(args, "query")
        ?? stringArg(args, "pattern");
      if (subject && !displayPath) subject = compactSingleLine(subject);
      break;
    }
  }

  return {
    action,
    subject,
    meta,
    inputText: serializeToolInput(inputForDetails(call, language), SERIALIZED_INPUT_LIMIT, language),
  };
}

export function resolveToolPhase(
  callId: string,
  result: ToolResult | undefined,
  executions: ToolExecutionsByCallId,
  assistantStreaming: boolean,
): ToolPhase {
  if (result?.isError) return "error";
  if (result) return "done";
  const execution = executions[callId];
  if (execution) return execution.phase;
  return assistantStreaming ? "queued" : "unknown";
}

export function toolPhaseLabel(phase: ToolPhase, language: ResolvedLanguage = "en"): string {
  switch (phase) {
    case "queued": return localize(language, "queued", "已排队");
    case "running": return localize(language, "running", "运行中");
    case "done": return localize(language, "done", "已完成");
    case "error": return localize(language, "failed", "失败");
    case "unknown": return localize(language, "unavailable", "不可用");
  }
}
