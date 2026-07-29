export type AutomationScheduleMode = "hourly" | "daily" | "weekdays" | "weekly" | "custom";
export type AutomationWeekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export interface AutomationSchedule {
  mode: AutomationScheduleMode;
  interval: number;
  time: string;
  minute: number;
  weekday: AutomationWeekday;
  customRrule: string;
}

export const AUTOMATION_WEEKDAYS: readonly AutomationWeekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const BUSINESS_DAYS: readonly AutomationWeekday[] = ["MO", "TU", "WE", "TH", "FR"];

export function defaultAutomationSchedule(mode: AutomationScheduleMode = "daily"): AutomationSchedule {
  return {
    mode,
    interval: 1,
    time: "09:00",
    minute: 0,
    weekday: "MO",
    customRrule: "FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0",
  };
}

function integerField(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseFields(rrule: string): Map<string, string> | null {
  const source = rrule.trim().replace(/^RRULE:/iu, "").toUpperCase();
  if (!source) return null;
  const fields = new Map<string, string>();
  for (const part of source.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0 || separator === part.length - 1) return null;
    const key = part.slice(0, separator);
    if (!new Set(["FREQ", "INTERVAL", "BYDAY", "BYHOUR", "BYMINUTE"]).has(key) || fields.has(key)) return null;
    fields.set(key, part.slice(separator + 1));
  }
  return fields;
}

export function parseAutomationSchedule(rrule: string): AutomationSchedule {
  const custom = { ...defaultAutomationSchedule("custom"), customRrule: rrule };
  const fields = parseFields(rrule);
  if (!fields) return custom;
  const interval = integerField(fields.get("INTERVAL"), 1);
  const hour = integerField(fields.get("BYHOUR"), 0);
  const minute = integerField(fields.get("BYMINUTE"), 0);
  if (interval === null || interval < 1 || interval > 365 || hour === null || hour < 0 || hour > 23 || minute === null || minute < 0 || minute > 59) {
    return custom;
  }
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const frequency = fields.get("FREQ");
  if (frequency === "HOURLY" && !fields.has("BYDAY") && !fields.has("BYHOUR")) {
    return { ...custom, mode: "hourly", interval, time, minute };
  }
  if (frequency === "DAILY" && !fields.has("BYDAY") && fields.has("BYHOUR")) {
    return { ...custom, mode: "daily", interval, time, minute };
  }
  if (frequency !== "WEEKLY" || !fields.has("BYHOUR")) return custom;
  const days = fields.get("BYDAY")?.split(",") ?? [];
  if (days.length === BUSINESS_DAYS.length && BUSINESS_DAYS.every((day) => days.includes(day))) {
    return { ...custom, mode: "weekdays", interval, time, minute };
  }
  if (days.length === 1 && AUTOMATION_WEEKDAYS.includes(days[0] as AutomationWeekday)) {
    return { ...custom, mode: "weekly", interval, time, minute, weekday: days[0] as AutomationWeekday };
  }
  return custom;
}

export function buildAutomationRRule(schedule: AutomationSchedule): string {
  if (schedule.mode === "custom") return schedule.customRrule.trim();
  if (!Number.isSafeInteger(schedule.interval) || schedule.interval < 1 || schedule.interval > 365) {
    throw new Error("Schedule interval must be from 1 to 365");
  }
  if (schedule.mode === "hourly") {
    if (!Number.isSafeInteger(schedule.minute) || schedule.minute < 0 || schedule.minute > 59) {
      throw new Error("Schedule minute must be from 0 to 59");
    }
    return `FREQ=HOURLY;INTERVAL=${schedule.interval};BYMINUTE=${schedule.minute}`;
  }
  const match = schedule.time.match(/^([01]\d|2[0-3]):([0-5]\d)$/u);
  if (!match) throw new Error("Schedule time must use HH:MM");
  const suffix = `BYHOUR=${Number(match[1])};BYMINUTE=${Number(match[2])}`;
  if (schedule.mode === "daily") return `FREQ=DAILY;INTERVAL=${schedule.interval};${suffix}`;
  if (schedule.mode === "weekdays") {
    return `FREQ=WEEKLY;INTERVAL=${schedule.interval};BYDAY=${BUSINESS_DAYS.join(",")};${suffix}`;
  }
  return `FREQ=WEEKLY;INTERVAL=${schedule.interval};BYDAY=${schedule.weekday};${suffix}`;
}
