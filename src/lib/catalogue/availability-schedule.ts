export type WeeklyScheduleWindow = {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
};

export type ScheduleException = {
  exceptionDate: string;
  closedAllDay: boolean;
  startMinute: number | null;
  endMinute: number | null;
  priority: number;
};

export type LocalDateTimeParts = {
  date: string;
  dayOfWeek: number;
  minuteOfDay: number;
};

export class AvailabilityScheduleError extends Error {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "AvailabilityScheduleError";
    this.field = field;
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function assertValidWeeklyWindow(window: WeeklyScheduleWindow) {
  if (!Number.isInteger(window.dayOfWeek) || window.dayOfWeek < 0 || window.dayOfWeek > 6) {
    throw new AvailabilityScheduleError(
      "dayOfWeek must be between 0 (Sunday) and 6 (Saturday).",
      "dayOfWeek",
    );
  }

  for (const [field, value] of [
    ["startMinute", window.startMinute],
    ["endMinute", window.endMinute],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || value >= 24 * 60) {
      throw new AvailabilityScheduleError(
        `${field} must be between 0 and 1439.`,
        field,
      );
    }
  }
}

export function assertValidScheduleException(exception: ScheduleException) {
  if (!DATE_PATTERN.test(exception.exceptionDate)) {
    throw new AvailabilityScheduleError(
      "exceptionDate must use YYYY-MM-DD format.",
      "exceptionDate",
    );
  }

  if (!exception.closedAllDay) {
    if (
      exception.startMinute == null ||
      exception.endMinute == null ||
      !Number.isInteger(exception.startMinute) ||
      !Number.isInteger(exception.endMinute)
    ) {
      throw new AvailabilityScheduleError(
        "Partial-day exceptions require startMinute and endMinute.",
        "startMinute",
      );
    }
  }
}

export function getLocalDateTimeParts(
  instant: Date,
  timeZone: string,
): LocalDateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(instant);
  const lookup = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const dayOfWeek = weekdayMap[lookup.weekday];
  if (dayOfWeek == null) {
    throw new AvailabilityScheduleError("Unable to resolve local weekday.", "timeZone");
  }

  const hour = Number.parseInt(lookup.hour, 10);
  const minute = Number.parseInt(lookup.minute, 10);

  return {
    date: `${lookup.year}-${lookup.month}-${lookup.day}`,
    dayOfWeek,
    minuteOfDay: hour * 60 + minute,
  };
}

function isMinuteWithinWindow(
  minuteOfDay: number,
  startMinute: number,
  endMinute: number,
) {
  if (endMinute > startMinute) {
    return minuteOfDay >= startMinute && minuteOfDay < endMinute;
  }

  return minuteOfDay >= startMinute || minuteOfDay < endMinute;
}

function resolveExceptionForDate(
  exceptions: ScheduleException[],
  localDate: string,
) {
  const matches = exceptions
    .filter((exception) => exception.exceptionDate === localDate)
    .sort((left, right) => right.priority - left.priority);

  return matches[0] ?? null;
}

export function isLocationOpenAt(input: {
  timeZone: string;
  at: Date;
  weeklyWindows: WeeklyScheduleWindow[];
  exceptions: ScheduleException[];
}) {
  const local = getLocalDateTimeParts(input.at, input.timeZone);
  const exception = resolveExceptionForDate(input.exceptions, local.date);

  if (exception) {
    if (exception.closedAllDay) {
      return false;
    }

    return isMinuteWithinWindow(
      local.minuteOfDay,
      exception.startMinute ?? 0,
      exception.endMinute ?? 0,
    );
  }

  if (input.weeklyWindows.length === 0) {
    return true;
  }

  const sameDayWindows = input.weeklyWindows.filter(
    (window) => window.dayOfWeek === local.dayOfWeek,
  );
  const previousDay = (local.dayOfWeek + 6) % 7;
  const overnightSpillWindows = input.weeklyWindows.filter(
    (window) =>
      window.dayOfWeek === previousDay && window.endMinute <= window.startMinute,
  );

  for (const window of [...sameDayWindows, ...overnightSpillWindows]) {
    if (isMinuteWithinWindow(local.minuteOfDay, window.startMinute, window.endMinute)) {
      return true;
    }
  }

  return false;
}
