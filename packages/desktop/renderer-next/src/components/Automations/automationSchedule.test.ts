import { describe, expect, it } from "vitest";
import { buildAutomationRRule, defaultAutomationSchedule, parseAutomationSchedule } from "./automationSchedule";

describe("automation schedule", () => {
  it("round-trips structured hourly, daily, weekday, and weekly schedules", () => {
    expect(parseAutomationSchedule("FREQ=HOURLY;INTERVAL=3;BYMINUTE=15")).toMatchObject({
      mode: "hourly",
      interval: 3,
      minute: 15,
    });
    expect(buildAutomationRRule({ ...defaultAutomationSchedule("daily"), interval: 2, time: "14:30" })).toBe(
      "FREQ=DAILY;INTERVAL=2;BYHOUR=14;BYMINUTE=30",
    );
    expect(buildAutomationRRule({ ...defaultAutomationSchedule("weekdays"), time: "08:05" })).toBe(
      "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR;BYHOUR=8;BYMINUTE=5",
    );
    expect(parseAutomationSchedule("FREQ=WEEKLY;INTERVAL=1;BYDAY=FR;BYHOUR=16;BYMINUTE=0")).toMatchObject({
      mode: "weekly",
      weekday: "FR",
      time: "16:00",
    });
  });

  it("keeps unsupported schedules in advanced RRULE mode", () => {
    const rrule = "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE;BYHOUR=9;BYMINUTE=0";
    expect(parseAutomationSchedule(rrule)).toMatchObject({ mode: "custom", customRrule: rrule });
  });
});
