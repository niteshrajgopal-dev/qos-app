import { describe, expect, it } from "vitest";

import {
  getLocalDateTimeParts,
  isLocationOpenAt,
  type ScheduleException,
  type WeeklyScheduleWindow,
} from "@/lib/catalogue/availability-schedule";

const weekdayOnly: WeeklyScheduleWindow[] = [
  { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 17 * 60 },
];

describe("availability schedule", () => {
  it("treats locations without windows as always open", () => {
    expect(
      isLocationOpenAt({
        timeZone: "Asia/Dubai",
        at: new Date("2026-09-13T10:00:00.000Z"),
        weeklyWindows: [],
        exceptions: [],
      }),
    ).toBe(true);
  });

  it("evaluates same-day windows in the location timezone", () => {
    expect(
      isLocationOpenAt({
        timeZone: "Asia/Dubai",
        at: new Date("2026-09-14T05:30:00.000Z"),
        weeklyWindows: weekdayOnly,
        exceptions: [],
      }),
    ).toBe(true);

    expect(
      isLocationOpenAt({
        timeZone: "Asia/Dubai",
        at: new Date("2026-09-14T03:30:00.000Z"),
        weeklyWindows: weekdayOnly,
        exceptions: [],
      }),
    ).toBe(false);
  });

  it("supports overnight windows that spill into the next local day", () => {
    const overnight: WeeklyScheduleWindow[] = [
      { dayOfWeek: 5, startMinute: 22 * 60, endMinute: 2 * 60 },
    ];

    expect(
      isLocationOpenAt({
        timeZone: "Asia/Dubai",
        at: new Date("2026-09-11T21:30:00.000Z"),
        weeklyWindows: overnight,
        exceptions: [],
      }),
    ).toBe(true);

    expect(
      isLocationOpenAt({
        timeZone: "Asia/Dubai",
        at: new Date("2026-09-11T23:00:00.000Z"),
        weeklyWindows: overnight,
        exceptions: [],
      }),
    ).toBe(false);
  });

  it("applies higher-priority exceptions over weekly windows", () => {
    const exceptions: ScheduleException[] = [
      {
        exceptionDate: "2026-09-14",
        closedAllDay: true,
        startMinute: null,
        endMinute: null,
        priority: 10,
      },
    ];

    expect(
      isLocationOpenAt({
        timeZone: "Asia/Dubai",
        at: new Date("2026-09-14T05:30:00.000Z"),
        weeklyWindows: weekdayOnly,
        exceptions,
      }),
    ).toBe(false);
  });

  it("handles a DST spring-forward fixture deterministically", () => {
    const parts = getLocalDateTimeParts(
      new Date("2026-03-08T07:30:00.000Z"),
      "America/New_York",
    );

    expect(parts.date).toBe("2026-03-08");
    expect(parts.dayOfWeek).toBe(0);

    expect(
      isLocationOpenAt({
        timeZone: "America/New_York",
        at: new Date("2026-03-08T07:30:00.000Z"),
        weeklyWindows: [{ dayOfWeek: 0, startMinute: 0, endMinute: 23 * 60 + 59 }],
        exceptions: [],
      }),
    ).toBe(true);
  });
});
