import type { Message } from "../../ipc/types";

export interface TaskSource {
  label: string;
  url: string;
}

export interface TaskArtifact {
  label: string;
  operation: "created" | "modified" | "referenced";
  path: string;
}

const MARKDOWN_LINK = /\[([^\]]+)\]\((?:<([^>]+)>|([^\s)]+))\)/g;
const HTTP_URL = /https?:\/\/[^\s<>"'`]+/gi;

function normalizeSource(rawUrl: string, label?: string): TaskSource | null {
  let candidate = rawUrl.replace(/[.,;:!?\]}]+$/u, "");
  while (
    candidate.endsWith(")") &&
    (candidate.match(/\)/g)?.length ?? 0) > (candidate.match(/\(/g)?.length ?? 0)
  ) {
    candidate = candidate.slice(0, -1);
  }
  try {
    const url = new URL(candidate);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return {
      label: label?.trim() || `${url.host.replace(/^www\./u, "")}${url.pathname === "/" ? "" : url.pathname}`,
      url: url.href,
    };
  } catch {
    return null;
  }
}

function normalizeArtifactPath(rawPath: string): string | null {
  let path = rawPath.trim();
  if (!path || path.startsWith("#")) return null;
  if (/^file:/iu.test(path)) {
    try {
      path = decodeURIComponent(new URL(path).pathname).replace(/^\/(?:[a-z]:\/)/iu, (value) => value.slice(1));
    } catch {
      return null;
    }
  } else if (/^[a-z][a-z\d+.-]*:/iu.test(path) && !/^[a-z]:[\\/]/iu.test(path)) {
    return null;
  }
  try {
    path = decodeURI(path);
  } catch {
    // Preserve a literal path when it contains malformed percent escapes.
  }
  const withoutLocation = path.replace(/:\d+(?::\d+)?$/u, "");
  return withoutLocation.replace(/\\/g, "/").trim() || null;
}

function artifactLabel(path: string): string {
  return path.replace(/[\\/]+$/u, "").split(/[\\/]/u).at(-1) || path;
}

function assistantTexts(messages: readonly Message[]): string[] {
  return messages.flatMap((message) =>
    message.role === "assistant"
      ? message.content.flatMap((block) => block.type === "text" && block.text ? [block.text] : [])
      : [],
  );
}

export function collectTaskSources(messages: readonly Message[]): TaskSource[] {
  const sources = new Map<string, TaskSource>();
  for (const text of assistantTexts(messages)) {
    for (const match of text.matchAll(MARKDOWN_LINK)) {
      const source = normalizeSource(match[2] ?? match[3] ?? "", match[1]);
      if (source && !sources.has(source.url)) sources.set(source.url, source);
    }
    for (const match of text.matchAll(HTTP_URL)) {
      const source = normalizeSource(match[0]);
      if (source && !sources.has(source.url)) sources.set(source.url, source);
    }
  }
  return [...sources.values()];
}

export function collectTaskArtifacts(messages: readonly Message[]): TaskArtifact[] {
  const artifacts = new Map<string, TaskArtifact>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type === "toolCall" && (block.name === "write" || block.name === "edit")) {
        const rawPath = typeof block.arguments.path === "string"
          ? block.arguments.path
          : typeof block.arguments.file_path === "string"
            ? block.arguments.file_path
            : "";
        const path = normalizeArtifactPath(rawPath);
        if (!path) continue;
        const key = path.toLocaleLowerCase("en");
        const previous = artifacts.get(key);
        artifacts.delete(key);
        artifacts.set(key, {
          label: artifactLabel(path),
          operation: previous?.operation === "created" || block.name === "write" ? "created" : "modified",
          path,
        });
        continue;
      }
      if (block.type !== "text" || !block.text) continue;
      for (const match of block.text.matchAll(MARKDOWN_LINK)) {
        const path = normalizeArtifactPath(match[2] ?? match[3] ?? "");
        if (!path) continue;
        const key = path.toLocaleLowerCase("en");
        if (artifacts.has(key)) continue;
        artifacts.set(key, { label: match[1].trim() || artifactLabel(path), operation: "referenced", path });
      }
    }
  }
  return [...artifacts.values()].reverse();
}
