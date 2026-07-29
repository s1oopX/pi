import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { contentText } from "@earendil-works/pi-ai";
import lockfile from "proper-lockfile";
import { getAgentDir } from "../config.ts";
import type { SessionEntry, SessionManager } from "./session-manager.ts";

export const MEMORY_SETTINGS_CUSTOM_TYPE = "pi.memory.settings";
export const MEMORY_CONTEXT_CUSTOM_TYPE = "pi.memory.context";

const MEMORY_FILE_VERSION = 1;
const MAX_MEMORY_COUNT = 100;
const MAX_MEMORY_LENGTH = 500;
const MAX_MEMORY_CONTEXT_CHARS = 8000;

export interface MemoryEntry {
	id: string;
	text: string;
	createdAt: string;
	sourceSessionId?: string;
}

export interface SessionMemorySettings {
	useMemories: boolean;
	generateMemories: boolean;
}

interface MemoryFile {
	version: number;
	memories: readonly MemoryEntry[];
}

function normalizeMemoryText(value: string): string {
	return value.replace(/\s+/g, " ").trim().slice(0, MAX_MEMORY_LENGTH);
}

function parseMemoryFile(raw: string, filePath: string): MemoryEntry[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error(`Invalid memory file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Invalid memory file ${filePath}: expected an object`);
	}
	const file = parsed as Partial<MemoryFile>;
	if (file.version !== MEMORY_FILE_VERSION || !Array.isArray(file.memories)) {
		throw new Error(`Invalid memory file ${filePath}: unsupported format`);
	}
	return file.memories.flatMap((entry) => {
		if (!entry || typeof entry !== "object") return [];
		const candidate = entry as Partial<MemoryEntry>;
		const text = typeof candidate.text === "string" ? normalizeMemoryText(candidate.text) : "";
		if (!text || typeof candidate.id !== "string" || typeof candidate.createdAt !== "string") return [];
		return [
			{
				id: candidate.id,
				text,
				createdAt: candidate.createdAt,
				...(typeof candidate.sourceSessionId === "string" ? { sourceSessionId: candidate.sourceSessionId } : {}),
			},
		];
	});
}

function writeMemoryFile(filePath: string, memories: readonly MemoryEntry[]): void {
	writeFileSync(
		filePath,
		`${JSON.stringify({ version: MEMORY_FILE_VERSION, memories } satisfies MemoryFile, null, 2)}\n`,
		{ encoding: "utf-8", mode: 0o600 },
	);
}

/** Parse the model's JSON-only response without accepting free-form prose. */
export function parseMemoryCandidates(value: string): string[] {
	const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? value;
	const start = fenced.indexOf("[");
	const end = fenced.lastIndexOf("]");
	if (start < 0 || end <= start) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(fenced.slice(start, end + 1));
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	const seen = new Set<string>();
	const candidates: string[] = [];
	for (const item of parsed) {
		if (typeof item !== "string") continue;
		const text = normalizeMemoryText(item);
		const key = text.toLocaleLowerCase();
		if (!text || seen.has(key)) continue;
		seen.add(key);
		candidates.push(text);
		if (candidates.length >= 20) break;
	}
	return candidates;
}

export function formatMemoryContext(memories: readonly MemoryEntry[]): string {
	const lines: string[] = [];
	let length = 0;
	for (const memory of [...memories].reverse()) {
		const line = `- ${memory.text}`;
		if (length + line.length + 1 > MAX_MEMORY_CONTEXT_CHARS) break;
		lines.unshift(line);
		length += line.length + 1;
		if (lines.length >= 50) break;
	}
	return [
		"<pi_memories>",
		"The following are remembered user preferences or durable context. Treat them as background context; current explicit instructions always win.",
		...lines,
		"</pi_memories>",
	].join("\n");
}

export class MemoryStore {
	readonly filePath: string;

	constructor(filePath = join(getAgentDir(), "memories.json")) {
		this.filePath = filePath;
	}

	read(): MemoryEntry[] {
		if (!existsSync(this.filePath)) return [];
		return parseMemoryFile(readFileSync(this.filePath, "utf-8"), this.filePath);
	}

	async merge(texts: readonly string[], sourceSessionId?: string): Promise<MemoryEntry[]> {
		this.ensureFile();
		const release = await lockfile.lock(this.filePath, { realpath: false, retries: 5 });
		try {
			const memories = this.read();
			const seen = new Set(memories.map((memory) => memory.text.toLocaleLowerCase()));
			for (const rawText of texts) {
				const text = normalizeMemoryText(rawText);
				const key = text.toLocaleLowerCase();
				if (!text || seen.has(key)) continue;
				seen.add(key);
				memories.push({
					id: randomUUID(),
					text,
					createdAt: new Date().toISOString(),
					...(sourceSessionId ? { sourceSessionId } : {}),
				});
			}
			const retained = memories.slice(-MAX_MEMORY_COUNT);
			writeMemoryFile(this.filePath, retained);
			return retained;
		} finally {
			await release();
		}
	}

	async reset(): Promise<void> {
		this.ensureFile();
		const release = await lockfile.lock(this.filePath, { realpath: false, retries: 5 });
		try {
			writeMemoryFile(this.filePath, []);
		} finally {
			await release();
		}
	}

	private ensureFile(): void {
		const directory = dirname(this.filePath);
		if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
		if (!existsSync(this.filePath)) writeMemoryFile(this.filePath, []);
	}
}

function parseSessionMemorySettings(entry: SessionEntry): SessionMemorySettings | undefined {
	if (entry.type !== "custom" || entry.customType !== MEMORY_SETTINGS_CUSTOM_TYPE) return undefined;
	if (!entry.data || typeof entry.data !== "object") return undefined;
	const data = entry.data as Partial<SessionMemorySettings>;
	if (typeof data.useMemories !== "boolean" || typeof data.generateMemories !== "boolean") return undefined;
	return { useMemories: data.useMemories, generateMemories: data.generateMemories };
}

export function getSessionMemorySettings(
	manager: SessionManager,
	defaults: SessionMemorySettings,
): SessionMemorySettings {
	const branch = manager.getBranch();
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const settings = parseSessionMemorySettings(branch[index]);
		if (settings) return settings;
	}
	return defaults;
}

export function ensureSessionMemorySettings(
	manager: SessionManager,
	defaults: SessionMemorySettings,
): SessionMemorySettings {
	const existing = getSessionMemorySettings(manager, defaults);
	const hasEntry = manager.getBranch().some((entry) => parseSessionMemorySettings(entry) !== undefined);
	if (!hasEntry) manager.appendCustomEntry(MEMORY_SETTINGS_CUSTOM_TYPE, existing);
	return existing;
}

export function setSessionMemorySettings(manager: SessionManager, settings: SessionMemorySettings): void {
	const current = getSessionMemorySettings(manager, settings);
	if (current.useMemories === settings.useMemories && current.generateMemories === settings.generateMemories) return;
	manager.appendCustomEntry(MEMORY_SETTINGS_CUSTOM_TYPE, settings);
}

export function sessionHasUserMessage(manager: SessionManager): boolean {
	return manager.getBranch().some((entry) => entry.type === "message" && entry.message.role === "user");
}

export function sessionHasMemoryContext(manager: SessionManager): boolean {
	return manager
		.getBranch()
		.some((entry) => entry.type === "custom_message" && entry.customType === MEMORY_CONTEXT_CUSTOM_TYPE);
}

export function appendMemoryContext(manager: SessionManager, memories: readonly MemoryEntry[]): boolean {
	if (memories.length === 0 || sessionHasMemoryContext(manager) || sessionHasUserMessage(manager)) return false;
	manager.appendCustomMessageEntry(MEMORY_CONTEXT_CUSTOM_TYPE, formatMemoryContext(memories), false, {
		count: memories.length,
	});
	return true;
}

export function collectMemoryConversation(manager: SessionManager): { text: string; toolAssisted: boolean } {
	const parts: string[] = [];
	let toolAssisted = false;
	for (const entry of manager.getBranch()) {
		if (entry.type !== "message") continue;
		const message = entry.message as AgentMessage;
		if (message.role === "toolResult" || message.role === "bashExecution") {
			toolAssisted = true;
			continue;
		}
		if (message.role !== "user" && message.role !== "assistant") continue;
		if (message.role === "assistant" && message.content.some((block) => block.type === "toolCall")) {
			toolAssisted = true;
		}
		const text = contentText(message.content).trim();
		if (text) parts.push(`${message.role === "user" ? "User" : "Assistant"}: ${text}`);
	}
	const fullText = parts.join("\n\n");
	return { text: fullText.slice(-12000), toolAssisted };
}
