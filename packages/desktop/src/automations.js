import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const AUTOMATIONS_VERSION = 1;
const MAX_AUTOMATIONS_BYTES = 2 * 1024 * 1024;
const MAX_HISTORY = 20;
const MAX_TIMER_DELAY_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONDAY_DAY_INDEX = Math.floor(Date.UTC(1970, 0, 5) / DAY_MS);
const DAY_NAMES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const DAY_ORDER = new Map(DAY_NAMES.map((day, index) => [day, index]));
const REASONING_EFFORTS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
let temporaryFileCounter = 0;

/** @typedef {"active" | "paused"} AutomationStatus */
/** @typedef {"running" | "success" | "error"} AutomationRunStatus */
/** @typedef {"all" | "failures"} AutomationNotificationPolicy */
/** @typedef {"cron" | "heartbeat"} AutomationKind */
/** @typedef {"local" | "worktree"} AutomationDestination */
/** @typedef {"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"} AutomationReasoningEffort */
/** @typedef {{ provider: string, id: string }} AutomationModel */
/** @typedef {{ source: string, scope: "user" | "project", name: string }} AutomationPromptTemplate */
/** @typedef {{ sessionId: string, sessionFile: string, cwd: string, sessionName?: string }} AutomationThread */
/** @typedef {{ path: string, branch: string }} AutomationWorktree */
/**
 * @typedef {object} AutomationRun
 * @property {string} id
 * @property {string} startedAt
 * @property {string | undefined} [finishedAt]
 * @property {AutomationRunStatus} status
 * @property {string | undefined} [sessionId]
 * @property {string | undefined} [sessionFile]
 * @property {string | undefined} [error]
 * @property {string | undefined} [readAt]
 * @property {string | undefined} [archivedAt]
 */
/**
 * @typedef {object} Automation
 * @property {string} id
 * @property {string} name
 * @property {string} prompt
 * @property {string} cwd
 * @property {string} rrule
 * @property {AutomationKind} kind
 * @property {AutomationDestination} destination
 * @property {AutomationStatus} status
 * @property {AutomationNotificationPolicy} notificationPolicy
 * @property {AutomationModel | undefined} [model]
 * @property {AutomationReasoningEffort | undefined} [reasoningEffort]
 * @property {AutomationPromptTemplate | undefined} [promptTemplate]
 * @property {AutomationThread | undefined} [thread]
 * @property {AutomationWorktree | undefined} [worktree]
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string | null} nextRunAt
 * @property {string | undefined} [lastRunAt]
 * @property {AutomationRunStatus | undefined} [lastRunStatus]
 * @property {string | undefined} [lastError]
 * @property {AutomationRun[]} runs
 */
/**
 * @typedef {object} ParsedRRule
 * @property {"MINUTELY" | "HOURLY" | "DAILY" | "WEEKLY"} frequency
 * @property {number} interval
 * @property {number | undefined} [hour]
 * @property {number | undefined} [minute]
 * @property {string[]} days
 * @property {string} canonical
 */
/**
 * @typedef {object} AutomationExecutionResult
 * @property {string | undefined} [sessionId]
 * @property {string | undefined} [sessionFile]
 * @property {string | undefined} [error]
 */

/**
 * @typedef {object} AutomationRuntimeTarget
 * @property {AutomationThread | undefined} [thread]
 * @property {AutomationWorktree | undefined} [worktree]
 */

/** @param {number} value @param {number} divisor */
function modulo(value, divisor) {
	return ((value % divisor) + divisor) % divisor;
}

/** @param {unknown} value @param {string} label @param {number} min @param {number} max */
function parseInteger(value, label, min, max) {
	if (!/^\d+$/u.test(String(value ?? ""))) throw new Error(`${label} must be an integer`);
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
		throw new Error(`${label} must be between ${min} and ${max}`);
	}
	return parsed;
}

/** @param {unknown} value @returns {ParsedRRule} */
export function parseRRule(value) {
	const source = String(value ?? "").trim().replace(/^RRULE:/iu, "").toUpperCase();
	if (!source) throw new Error("RRULE is required");
	if (source.length > 500) throw new Error("RRULE is too long");

	/** @type {Map<string, string>} */
	const fields = new Map();
	for (const part of source.split(";")) {
		const separator = part.indexOf("=");
		if (separator <= 0 || separator === part.length - 1) throw new Error(`Invalid RRULE part: ${part}`);
		const key = part.slice(0, separator).trim();
		const fieldValue = part.slice(separator + 1).trim();
		if (!new Set(["FREQ", "INTERVAL", "BYDAY", "BYHOUR", "BYMINUTE"]).has(key)) {
			throw new Error(`Unsupported RRULE field: ${key}`);
		}
		if (fields.has(key)) throw new Error(`Duplicate RRULE field: ${key}`);
		fields.set(key, fieldValue);
	}

	const frequency = fields.get("FREQ");
	if (frequency !== "MINUTELY" && frequency !== "HOURLY" && frequency !== "DAILY" && frequency !== "WEEKLY") {
		throw new Error("FREQ must be MINUTELY, HOURLY, DAILY, or WEEKLY");
	}
	const interval = fields.has("INTERVAL") ? parseInteger(fields.get("INTERVAL"), "INTERVAL", 1, 365) : 1;
	const hasHour = fields.has("BYHOUR");
	const hasMinute = fields.has("BYMINUTE");
	const hasDays = fields.has("BYDAY");

	if (frequency === "MINUTELY" && (hasHour || hasMinute || hasDays)) {
		throw new Error("MINUTELY rules only support INTERVAL");
	}
	if (frequency === "HOURLY" && (hasHour || hasDays)) {
		throw new Error("HOURLY rules only support INTERVAL and BYMINUTE");
	}
	if (frequency === "DAILY" && hasDays) throw new Error("DAILY rules do not support BYDAY");

	const hour = frequency === "DAILY" || frequency === "WEEKLY"
		? hasHour ? parseInteger(fields.get("BYHOUR"), "BYHOUR", 0, 23) : 9
		: undefined;
	const minute = frequency === "MINUTELY"
		? undefined
		: hasMinute ? parseInteger(fields.get("BYMINUTE"), "BYMINUTE", 0, 59) : 0;
	/** @type {string[]} */
	let days = [];
	if (frequency === "WEEKLY") {
		days = hasDays ? [...new Set(String(fields.get("BYDAY")).split(","))] : ["MO"];
		if (days.length === 0 || days.some((day) => !DAY_ORDER.has(day))) {
			throw new Error("BYDAY must contain MO, TU, WE, TH, FR, SA, or SU");
		}
		days.sort((left, right) => /** @type {number} */ (DAY_ORDER.get(left)) - /** @type {number} */ (DAY_ORDER.get(right)));
	}

	const canonical = [`FREQ=${frequency}`, `INTERVAL=${interval}`];
	if (frequency === "WEEKLY") canonical.push(`BYDAY=${days.join(",")}`);
	if (hour !== undefined) canonical.push(`BYHOUR=${hour}`);
	if (minute !== undefined && frequency !== "MINUTELY") canonical.push(`BYMINUTE=${minute}`);
	return { frequency, interval, hour, minute, days, canonical: canonical.join(";") };
}

/** @param {Date} date */
function localDayIndex(date) {
	return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

/** @param {unknown} rrule @param {number} afterMs */
export function nextAutomationRun(rrule, afterMs) {
	if (!Number.isFinite(afterMs)) throw new Error("The schedule reference time is invalid");
	const rule = parseRRule(rrule);

	if (rule.frequency === "MINUTELY") {
		const intervalMs = rule.interval * MINUTE_MS;
		return new Date((Math.floor(afterMs / intervalMs) + 1) * intervalMs).toISOString();
	}

	if (rule.frequency === "HOURLY") {
		const candidate = new Date(afterMs);
		candidate.setMinutes(rule.minute ?? 0, 0, 0);
		if (candidate.getTime() <= afterMs) candidate.setHours(candidate.getHours() + 1);
		for (let index = 0; index < 24 * 366 * 10; index += 1) {
			if (modulo(Math.floor(candidate.getTime() / HOUR_MS), rule.interval) === 0) {
				return candidate.toISOString();
			}
			candidate.setHours(candidate.getHours() + 1);
			candidate.setMinutes(rule.minute ?? 0, 0, 0);
		}
	}

	const candidate = new Date(afterMs);
	candidate.setHours(rule.hour ?? 9, rule.minute ?? 0, 0, 0);
	if (candidate.getTime() <= afterMs) candidate.setDate(candidate.getDate() + 1);
	for (let index = 0; index < 366 * 20; index += 1) {
		const dayIndex = localDayIndex(candidate);
		if (rule.frequency === "DAILY" && modulo(dayIndex, rule.interval) === 0) {
			return candidate.toISOString();
		}
		if (rule.frequency === "WEEKLY") {
			const weekIndex = Math.floor((dayIndex - MONDAY_DAY_INDEX) / 7);
			if (modulo(weekIndex, rule.interval) === 0 && rule.days.includes(DAY_NAMES[candidate.getDay()])) {
				return candidate.toISOString();
			}
		}
		candidate.setDate(candidate.getDate() + 1);
		candidate.setHours(rule.hour ?? 9, rule.minute ?? 0, 0, 0);
	}
	throw new Error("Could not find the next run within 20 years");
}

/** @param {unknown} value @param {string} label @param {number} maxLength */
function requiredText(value, label, maxLength) {
	const text = String(value ?? "").trim();
	if (!text) throw new Error(`${label} is required`);
	if (text.length > maxLength) throw new Error(`${label} is too long`);
	return text;
}

/** @param {unknown} value @returns {AutomationPromptTemplate | undefined} */
function parsePromptTemplate(value) {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Prompt template must include a package source, scope, and name");
	}
	const record = /** @type {Record<string, unknown>} */ (value);
	if (record.scope !== "user" && record.scope !== "project") {
		throw new Error("Prompt template scope must be user or project");
	}
	return {
		source: requiredText(record.source, "Prompt template source", 4096),
		scope: record.scope,
		name: requiredText(record.name, "Prompt template name", 500),
	};
}

/** @param {string} path */
function isDirectory(path) {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/**
 * @param {unknown} input
 * @param {(path: string) => boolean} directoryCheck
 * @returns {{ name: string, prompt: string, cwd: string, rrule: string, kind: AutomationKind, destination: AutomationDestination, status: AutomationStatus, notificationPolicy: AutomationNotificationPolicy, model?: AutomationModel, reasoningEffort?: AutomationReasoningEffort, promptTemplate?: AutomationPromptTemplate }}
 */
function validateInput(input, directoryCheck) {
	if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Automation details are required");
	const record = /** @type {Record<string, unknown>} */ (input);
	const name = requiredText(record.name, "Name", 120);
	const prompt = requiredText(record.prompt, "Prompt", 20_000);
	const cwd = requiredText(record.cwd, "Workspace", 4096);
	if (!directoryCheck(cwd)) throw new Error(`Workspace not found: ${cwd}`);
	const rrule = parseRRule(record.rrule).canonical;
	if (record.kind !== undefined && record.kind !== "cron" && record.kind !== "heartbeat") {
		throw new Error("Automation type must be cron or heartbeat");
	}
	const kind = /** @type {AutomationKind} */ (record.kind === "heartbeat" ? "heartbeat" : "cron");
	if (record.destination !== undefined && record.destination !== "local" && record.destination !== "worktree") {
		throw new Error("Destination must be local or worktree");
	}
	const destination = /** @type {AutomationDestination} */ (record.destination === "worktree" ? "worktree" : "local");
	if (kind === "heartbeat" && destination !== "local") {
		throw new Error("Heartbeat automations must run in the bound conversation");
	}
	const status = record.status === "paused" ? "paused" : "active";
	if (record.notificationPolicy !== undefined && record.notificationPolicy !== "all" && record.notificationPolicy !== "failures") {
		throw new Error("Notification policy must be all or failures");
	}
	const notificationPolicy = /** @type {AutomationNotificationPolicy} */ (
		record.notificationPolicy === "failures" ? "failures" : "all"
	);
	/** @type {AutomationModel | undefined} */
	let model;
	if (record.model !== undefined) {
		if (!record.model || typeof record.model !== "object" || Array.isArray(record.model)) {
			throw new Error("Model must include a provider and ID");
		}
		const modelRecord = /** @type {Record<string, unknown>} */ (record.model);
		model = {
			provider: requiredText(modelRecord.provider, "Model provider", 200),
			id: requiredText(modelRecord.id, "Model ID", 500),
		};
	}
	if (record.reasoningEffort !== undefined && !REASONING_EFFORTS.has(String(record.reasoningEffort))) {
		throw new Error("Reasoning effort is invalid");
	}
	const reasoningEffort = /** @type {AutomationReasoningEffort | undefined} */ (record.reasoningEffort);
	const promptTemplate = parsePromptTemplate(record.promptTemplate);
	return {
		name,
		prompt,
		cwd,
		rrule,
		kind,
		destination,
		status,
		notificationPolicy,
		model,
		reasoningEffort,
		promptTemplate,
	};
}

/** @param {unknown} value */
function isoString(value) {
	if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
	return new Date(value).toISOString();
}

/** @param {unknown} value @param {string} recoveredAt @returns {AutomationRun | undefined} */
function sanitizeRun(value, recoveredAt) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = /** @type {Record<string, unknown>} */ (value);
	const id = typeof record.id === "string" && record.id ? record.id : undefined;
	const startedAt = isoString(record.startedAt);
	if (!id || !startedAt) return undefined;
	const persistedStatus = record.status === "success" || record.status === "error" ? record.status : "running";
	const recovered = persistedStatus === "running";
	return {
		id,
		startedAt,
		...(isoString(record.finishedAt) ? { finishedAt: isoString(record.finishedAt) } : {}),
		status: /** @type {AutomationRunStatus} */ (recovered ? "error" : persistedStatus),
		...(typeof record.sessionId === "string" && record.sessionId ? { sessionId: record.sessionId } : {}),
		...(typeof record.sessionFile === "string" && record.sessionFile ? { sessionFile: record.sessionFile } : {}),
		...(isoString(record.readAt) ? { readAt: isoString(record.readAt) } : {}),
		...(isoString(record.archivedAt) ? { archivedAt: isoString(record.archivedAt) } : {}),
		...(recovered
			? { finishedAt: recoveredAt, error: "Pi Studio closed before this run finished." }
			: typeof record.error === "string" && record.error ? { error: record.error.slice(0, 2000) } : {}),
	};
}

/** @param {unknown} value @param {number} nowMs @returns {Automation | undefined} */
function sanitizeAutomation(value, nowMs) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = /** @type {Record<string, unknown>} */ (value);
	if (typeof record.id !== "string" || !record.id) return undefined;
	let rrule;
	try {
		rrule = parseRRule(record.rrule).canonical;
	} catch {
		return undefined;
	}
	const name = typeof record.name === "string" ? record.name.trim().slice(0, 120) : "";
	const prompt = typeof record.prompt === "string" ? record.prompt.trim().slice(0, 20_000) : "";
	const cwd = typeof record.cwd === "string" ? record.cwd.trim().slice(0, 4096) : "";
	if (!name || !prompt || !cwd) return undefined;
	const kind = /** @type {AutomationKind} */ (record.kind === "heartbeat" ? "heartbeat" : "cron");
	const destination = /** @type {AutomationDestination} */ (record.destination === "worktree" ? "worktree" : "local");
	if (kind === "heartbeat" && destination !== "local") return undefined;
	/** @type {AutomationModel | undefined} */
	let model;
	if (record.model && typeof record.model === "object" && !Array.isArray(record.model)) {
		const modelRecord = /** @type {Record<string, unknown>} */ (record.model);
		const provider = typeof modelRecord.provider === "string" ? modelRecord.provider.trim().slice(0, 200) : "";
		const id = typeof modelRecord.id === "string" ? modelRecord.id.trim().slice(0, 500) : "";
		if (provider && id) model = { provider, id };
	}
	const reasoningEffort = REASONING_EFFORTS.has(String(record.reasoningEffort))
		? /** @type {AutomationReasoningEffort} */ (record.reasoningEffort)
		: undefined;
	/** @type {AutomationPromptTemplate | undefined} */
	let promptTemplate;
	try {
		promptTemplate = parsePromptTemplate(record.promptTemplate);
	} catch {}
	/** @type {AutomationThread | undefined} */
	let thread;
	if (record.thread && typeof record.thread === "object" && !Array.isArray(record.thread)) {
		const threadRecord = /** @type {Record<string, unknown>} */ (record.thread);
		const sessionId = typeof threadRecord.sessionId === "string" ? threadRecord.sessionId.trim().slice(0, 500) : "";
		const sessionFile = typeof threadRecord.sessionFile === "string" ? threadRecord.sessionFile.trim().slice(0, 4096) : "";
		const threadCwd = typeof threadRecord.cwd === "string" ? threadRecord.cwd.trim().slice(0, 4096) : "";
		const sessionName = typeof threadRecord.sessionName === "string" ? threadRecord.sessionName.trim().slice(0, 500) : "";
		if (sessionId && sessionFile && threadCwd) {
			thread = { sessionId, sessionFile, cwd: threadCwd, ...(sessionName ? { sessionName } : {}) };
		}
	}
	if (kind === "heartbeat" && !thread) return undefined;
	/** @type {AutomationWorktree | undefined} */
	let worktree;
	if (record.worktree && typeof record.worktree === "object" && !Array.isArray(record.worktree)) {
		const worktreeRecord = /** @type {Record<string, unknown>} */ (record.worktree);
		const path = typeof worktreeRecord.path === "string" ? worktreeRecord.path.trim().slice(0, 4096) : "";
		const branch = typeof worktreeRecord.branch === "string" ? worktreeRecord.branch.trim().slice(0, 500) : "";
		if (path && branch) worktree = { path, branch };
	}
	if (destination === "worktree" && !worktree) return undefined;
	const now = new Date(nowMs).toISOString();
	const status = record.status === "paused" ? "paused" : "active";
	const runs = Array.isArray(record.runs)
		? record.runs.map((run) => sanitizeRun(run, now)).filter((run) => run !== undefined).slice(0, MAX_HISTORY)
		: [];
	const latest = runs[0];
	return {
		id: record.id,
		name,
		prompt,
		cwd,
		rrule,
		kind,
		destination,
		status,
		notificationPolicy: record.notificationPolicy === "failures" ? "failures" : "all",
		...(model ? { model } : {}),
		...(reasoningEffort ? { reasoningEffort } : {}),
		...(promptTemplate ? { promptTemplate } : {}),
		...(thread ? { thread } : {}),
		...(worktree ? { worktree } : {}),
		createdAt: isoString(record.createdAt) ?? now,
		updatedAt: isoString(record.updatedAt) ?? now,
		nextRunAt: status === "paused" ? null : isoString(record.nextRunAt) ?? nextAutomationRun(rrule, nowMs),
		...(isoString(record.lastRunAt) || latest ? { lastRunAt: isoString(record.lastRunAt) ?? latest?.startedAt } : {}),
		...(latest ? { lastRunStatus: latest.status } : {}),
		...(latest?.error ? { lastError: latest.error } : {}),
		runs,
	};
}

/** @param {Automation} automation @returns {Automation} */
function snapshot(automation) {
	return {
		...automation,
		...(automation.model ? { model: { ...automation.model } } : {}),
		...(automation.promptTemplate ? { promptTemplate: { ...automation.promptTemplate } } : {}),
		...(automation.thread ? { thread: { ...automation.thread } } : {}),
		...(automation.worktree ? { worktree: { ...automation.worktree } } : {}),
		runs: automation.runs.map((run) => ({ ...run })),
	};
}

/** @param {string} filePath @param {Automation[]} automations */
function saveState(filePath, automations) {
	mkdirSync(dirname(filePath), { recursive: true });
	const temporaryPath = `${filePath}.${process.pid}.${++temporaryFileCounter}.tmp`;
	try {
		writeFileSync(
			temporaryPath,
			`${JSON.stringify({ version: AUTOMATIONS_VERSION, automations }, null, 2)}\n`,
			{ encoding: "utf8", flag: "wx", mode: 0o600 },
		);
		renameSync(temporaryPath, filePath);
	} finally {
		rmSync(temporaryPath, { force: true });
	}
}

/** @param {string} filePath @param {number} nowMs */
function loadState(filePath, nowMs) {
	try {
		const stats = statSync(filePath);
		if (!stats.isFile()) {
			return { automations: [], recovered: false, error: new Error("Automation state path is not a file") };
		}
		if (stats.size > MAX_AUTOMATIONS_BYTES) {
			return { automations: [], recovered: false, error: new Error("Automation state file is too large") };
		}
		const parsed = JSON.parse(readFileSync(filePath, "utf8"));
		if (!parsed || typeof parsed !== "object" || parsed.version !== AUTOMATIONS_VERSION || !Array.isArray(parsed.automations)) {
			return { automations: [], recovered: false, error: new Error("Automation state file has an unsupported format") };
		}
		const rawAutomations = /** @type {unknown[]} */ (parsed.automations);
		const automations = rawAutomations.map((automation) => sanitizeAutomation(automation, nowMs));
		if (automations.some((automation) => automation === undefined)) {
			return { automations: [], recovered: false, error: new Error("Automation state file contains an invalid record") };
		}
		const validAutomations = /** @type {Automation[]} */ (automations);
		const recovered = validAutomations.some((automation) => automation.runs.some((run) => run.error === "Pi Studio closed before this run finished."));
		return { automations: validAutomations, recovered };
	} catch (error) {
		if (/** @type {{ code?: unknown }} */ (error)?.code === "ENOENT") {
			return { automations: [], recovered: false };
		}
		return {
			automations: [],
			recovered: false,
			error: new Error(`Could not load automation state: ${error instanceof Error ? error.message : String(error)}`),
		};
	}
}

/**
 * @param {object} options
 * @param {string} options.filePath
 * @param {(automation: Automation, run: AutomationRun) => Promise<AutomationExecutionResult>} options.runAutomation
 * @param {(automations: Automation[]) => void} [options.onChange]
 * @param {(automation: Automation, run: AutomationRun) => void} [options.onRunComplete]
 * @param {(error: unknown) => void} [options.onError]
 * @param {() => number} [options.now]
 * @param {(path: string) => boolean} [options.isDirectory]
 */
export function createAutomationService({
	filePath,
	runAutomation,
	onChange = () => {},
	onRunComplete = () => {},
	onError = () => {},
	now = Date.now,
	isDirectory: directoryCheck = isDirectory,
}) {
	const loaded = loadState(filePath, now());
	/** @type {Automation[]} */
	let automations = loaded.automations;
	const loadError = loaded.error;
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;
	let stopped = false;
	/** @type {Set<string>} */
	const runningIds = new Set();
	/** @type {Set<Promise<void>>} */
	const activePromises = new Set();
	if (loadError) onError(loadError);
	if (loaded.recovered) saveState(filePath, automations);

	function emit() {
		try {
			onChange(automations.map(snapshot));
		} catch (error) {
			onError(error);
		}
	}

	/** @param {Automation[]} next */
	function commit(next) {
		if (loadError) {
			throw new Error(`${loadError.message}. The original file was not changed.`);
		}
		saveState(filePath, next);
		automations = next;
		emit();
		scheduleNext();
	}

	/** @param {string} id */
	function findIndex(id) {
		const index = automations.findIndex((automation) => automation.id === id);
		if (index === -1) throw new Error(`Unknown automation: ${id}`);
		return index;
	}

	function scheduleNext() {
		clearTimeout(timer);
		timer = undefined;
		if (stopped) return;
		const nextRunMs = automations
			.filter((automation) => automation.status === "active" && automation.nextRunAt && !runningIds.has(automation.id))
			.map((automation) => Date.parse(/** @type {string} */ (automation.nextRunAt)))
			.filter(Number.isFinite)
			.reduce((earliest, value) => Math.min(earliest, value), Number.POSITIVE_INFINITY);
		if (!Number.isFinite(nextRunMs)) return;
		const delay = Math.max(25, Math.min(MAX_TIMER_DELAY_MS, nextRunMs - now()));
		timer = setTimeout(() => {
			timer = undefined;
			try {
				runDue();
			} catch (error) {
				onError(error);
			}
			scheduleNext();
		}, delay);
		timer.unref?.();
	}

	/** @param {string} id @param {boolean} scheduled */
	function startRun(id, scheduled) {
		if (runningIds.has(id)) throw new Error("This automation is already running");
		const index = findIndex(id);
		const automation = automations[index];
		const startedAtMs = now();
		const startedAt = new Date(startedAtMs).toISOString();
		/** @type {AutomationRun} */
		const run = { id: randomUUID(), startedAt, status: "running" };
		const started = {
			...automation,
			updatedAt: startedAt,
			lastRunAt: startedAt,
			lastRunStatus: /** @type {AutomationRunStatus} */ ("running"),
			lastError: undefined,
			nextRunAt: scheduled ? nextAutomationRun(automation.rrule, startedAtMs) : automation.nextRunAt,
			runs: [run, ...automation.runs].slice(0, MAX_HISTORY),
		};
		const next = [...automations];
		next[index] = started;
		commit(next);
		runningIds.add(id);

		/** @type {Promise<void>} */
		let pending;
		pending = (async () => {
			/** @type {AutomationExecutionResult} */
			let result;
			try {
				result = await runAutomation(snapshot(started), { ...run });
			} catch (error) {
				result = { error: error instanceof Error ? error.message : String(error) };
			}
			const finishedAt = new Date(now()).toISOString();
			const status = result.error ? "error" : "success";
			const currentIndex = automations.findIndex((candidate) => candidate.id === id);
			if (currentIndex === -1) return;
			const current = automations[currentIndex];
			const finishedRun = {
				...current.runs.find((candidate) => candidate.id === run.id),
				id: run.id,
				startedAt,
				finishedAt,
				status: /** @type {AutomationRunStatus} */ (status),
				...(result.sessionId ? { sessionId: result.sessionId } : {}),
				...(result.sessionFile ? { sessionFile: result.sessionFile } : {}),
				...(result.error ? { error: result.error.slice(0, 2000) } : {}),
			};
			const finished = {
				...current,
				updatedAt: finishedAt,
				lastRunStatus: /** @type {AutomationRunStatus} */ (status),
				lastError: result.error ? result.error.slice(0, 2000) : undefined,
				runs: current.runs.map((candidate) => candidate.id === run.id ? finishedRun : candidate),
			};
			const finishedState = [...automations];
			finishedState[currentIndex] = finished;
			try {
				commit(finishedState);
			} catch (error) {
				automations = finishedState;
				emit();
				onError(error);
			}
			try {
				onRunComplete(snapshot(finished), { ...finishedRun });
			} catch (error) {
				onError(error);
			}
		})().finally(() => {
			runningIds.delete(id);
			activePromises.delete(pending);
			scheduleNext();
		});
		activePromises.add(pending);
		return snapshot(started);
	}

	function runDue() {
		const dueIds = automations
			.filter((automation) =>
				automation.status === "active" &&
				automation.nextRunAt !== null &&
				Date.parse(automation.nextRunAt) <= now() &&
				!runningIds.has(automation.id),
			)
			.map((automation) => automation.id);
		return dueIds.map((id) => startRun(id, true));
	}

	scheduleNext();

	return {
		getLoadError() {
			return loadError;
		},

		list() {
			return automations.map(snapshot);
		},

		/** @param {unknown} input @param {AutomationRuntimeTarget} [runtimeTarget] */
		create(input, runtimeTarget = {}) {
			const validated = validateInput(input, directoryCheck);
			/** @type {AutomationThread | undefined} */
			let thread;
			if (validated.kind === "heartbeat") {
				const target = runtimeTarget.thread;
				if (!target) throw new Error("Heartbeat automations must bind the current conversation");
				const sessionId = requiredText(target.sessionId, "Session ID", 500);
				const sessionFile = requiredText(target.sessionFile, "Session file", 4096);
				const cwd = requiredText(target.cwd, "Session workspace", 4096);
				if (!directoryCheck(cwd)) throw new Error(`Workspace not found: ${cwd}`);
				const sessionName = String(target.sessionName ?? "").trim().slice(0, 500);
				thread = { sessionId, sessionFile, cwd, ...(sessionName ? { sessionName } : {}) };
				validated.cwd = cwd;
			}
			/** @type {AutomationWorktree | undefined} */
			let worktree;
			if (validated.destination === "worktree") {
				const target = runtimeTarget.worktree;
				if (!target) throw new Error("Worktree automations need a provisioned worktree");
				const path = requiredText(target.path, "Worktree path", 4096);
				if (!directoryCheck(path)) throw new Error(`Worktree not found: ${path}`);
				worktree = { path, branch: requiredText(target.branch, "Worktree branch", 500) };
			}
			const createdAtMs = now();
			const createdAt = new Date(createdAtMs).toISOString();
			/** @type {Automation} */
			const automation = {
				id: randomUUID(),
				...validated,
				...(thread ? { thread } : {}),
				...(worktree ? { worktree } : {}),
				createdAt,
				updatedAt: createdAt,
				nextRunAt: validated.status === "active" ? nextAutomationRun(validated.rrule, createdAtMs) : null,
				runs: [],
			};
			commit([automation, ...automations]);
			return snapshot(automation);
		},

		/** @param {unknown} id @param {unknown} input */
		update(id, input) {
			const automationId = String(id ?? "");
			if (runningIds.has(automationId)) throw new Error("Wait for the current run to finish before editing");
			const index = findIndex(automationId);
			const validated = validateInput(input, directoryCheck);
			const updatedAtMs = now();
			const updatedAt = new Date(updatedAtMs).toISOString();
			const current = automations[index];
			// ponytail: target provisioning is immutable; recreate the automation if it must move.
			if (validated.kind !== current.kind) throw new Error("Automation type cannot be changed after creation");
			if (validated.destination !== current.destination) {
				throw new Error("Automation destination cannot be changed after creation");
			}
			if ((current.kind === "heartbeat" || current.destination === "worktree") && validated.cwd !== current.cwd) {
				throw new Error("The workspace for this automation cannot be changed");
			}
			/** @type {Automation} */
			const updated = {
				...current,
				...validated,
				status: current.status,
				updatedAt,
				nextRunAt: current.status === "active" ? nextAutomationRun(validated.rrule, updatedAtMs) : null,
			};
			const next = [...automations];
			next[index] = updated;
			commit(next);
			return snapshot(updated);
		},

		/** @param {unknown} id @param {unknown} status */
		setStatus(id, status) {
			const automationId = String(id ?? "");
			if (status !== "active" && status !== "paused") throw new Error("Status must be active or paused");
			const nextStatus = /** @type {AutomationStatus} */ (status);
			const index = findIndex(automationId);
			const updatedAtMs = now();
			/** @type {Automation} */
			const updated = {
				...automations[index],
				status: nextStatus,
				updatedAt: new Date(updatedAtMs).toISOString(),
				nextRunAt: nextStatus === "active" ? nextAutomationRun(automations[index].rrule, updatedAtMs) : null,
			};
			const next = [...automations];
			next[index] = updated;
			commit(next);
			return snapshot(updated);
		},

		/** @param {unknown} id */
		delete(id) {
			const automationId = String(id ?? "");
			if (runningIds.has(automationId)) throw new Error("Wait for the current run to finish before deleting");
			const index = findIndex(automationId);
			const deleted = automations[index];
			commit(automations.filter((automation) => automation.id !== automationId));
			return snapshot(deleted);
		},

		/** @param {unknown} id @param {unknown} runId @param {unknown} action */
		updateRun(id, runId, action) {
			const automationId = String(id ?? "");
			const targetRunId = String(runId ?? "");
			if (action !== "read" && action !== "unread" && action !== "archive" && action !== "restore") {
				throw new Error("Run action must be read, unread, archive, or restore");
			}
			const index = findIndex(automationId);
			const automation = automations[index];
			const runIndex = automation.runs.findIndex((run) => run.id === targetRunId);
			if (runIndex === -1) throw new Error(`Unknown automation run: ${targetRunId}`);
			const currentRun = automation.runs[runIndex];
			if (currentRun.status === "running") throw new Error("Wait for the run to finish before updating it");
			const updatedAt = new Date(now()).toISOString();
			let readAt = currentRun.readAt;
			let archivedAt = currentRun.archivedAt;
			if (action === "read") readAt = updatedAt;
			if (action === "unread") readAt = undefined;
			if (action === "archive") {
				readAt ??= updatedAt;
				archivedAt = updatedAt;
			}
			if (action === "restore") archivedAt = undefined;
			const runs = [...automation.runs];
			runs[runIndex] = { ...currentRun, readAt, archivedAt };
			const updated = { ...automation, updatedAt, runs };
			const next = [...automations];
			next[index] = updated;
			commit(next);
			return snapshot(updated);
		},

		/** @param {unknown} id */
		runNow(id) {
			return startRun(String(id ?? ""), false);
		},

		runDue,

		async waitForIdle() {
			while (activePromises.size > 0) await Promise.allSettled([...activePromises]);
		},

		stop() {
			stopped = true;
			clearTimeout(timer);
			timer = undefined;
		},
	};
}
