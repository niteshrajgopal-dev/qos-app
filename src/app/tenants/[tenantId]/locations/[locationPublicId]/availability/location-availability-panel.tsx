"use client";

import { useCallback, useState } from "react";

import { staffApiFetch } from "@/lib/staff/dev-fetch";

type WeeklyWindow = {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
};

type ScheduleException = {
  id: string;
  exceptionDate: string;
  closedAllDay: boolean;
  startMinute: number | null;
  endMinute: number | null;
  priority: number;
  label: string | null;
};

type ScheduleView = {
  locationPublicId: string;
  locationName: string;
  timezone: string;
  isOpenNow: boolean;
  weeklyWindows: WeeklyWindow[];
  exceptions: ScheduleException[];
};

type StopSaleView = {
  id: string;
  targetType: "product" | "variant" | "modifier_option";
  targetPublicId: string;
  reason: string;
  startsAt: string;
  expiresAt: string | null;
};

type LocationAvailabilityPanelProps = {
  tenantId: string;
  locationPublicId: string;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function minuteToTime(minute: number) {
  const hours = Math.floor(minute / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (minute % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function timeToMinute(value: string) {
  const [hours, minutes] = value.split(":");
  const hour = Number.parseInt(hours ?? "", 10);
  const minute = Number.parseInt(minutes ?? "", 10);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return null;
  }

  return hour * 60 + minute;
}

export function LocationAvailabilityPanel({
  tenantId,
  locationPublicId,
}: LocationAvailabilityPanelProps) {
  const [schedule, setSchedule] = useState<ScheduleView | null>(null);
  const [stopSales, setStopSales] = useState<StopSaleView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftWindows, setDraftWindows] = useState<
    Array<WeeklyWindow & { key: string }>
  >([]);
  const [stopSaleDraft, setStopSaleDraft] = useState({
    targetType: "product" as StopSaleView["targetType"],
    targetPublicId: "",
    reason: "",
    expiresAt: "",
  });

  const basePath = `/api/tenants/${tenantId}/locations/${locationPublicId}/availability`;

  const loadAvailability = useCallback(async () => {
    setError(null);

    const [scheduleResponse, stopSalesResponse] = await Promise.all([
      staffApiFetch(`${basePath}/schedule`),
      staffApiFetch(`${basePath}/stop-sales`),
    ]);

    const schedulePayload = (await scheduleResponse.json()) as {
      schedule?: ScheduleView;
      error?: string;
    };
    const stopSalesPayload = (await stopSalesResponse.json()) as {
      stopSales?: StopSaleView[];
      error?: string;
    };

    if (!scheduleResponse.ok) {
      throw new Error(schedulePayload.error ?? "Unable to load schedule.");
    }

    if (!stopSalesResponse.ok) {
      throw new Error(stopSalesPayload.error ?? "Unable to load stop-sales.");
    }

    const nextSchedule = schedulePayload.schedule ?? null;
    setSchedule(nextSchedule);
    setStopSales(stopSalesPayload.stopSales ?? []);
    setDraftWindows(
      (nextSchedule?.weeklyWindows ?? []).map((window, index) => ({
        ...window,
        key: `${window.dayOfWeek}-${index}`,
      })),
    );
  }, [basePath]);

  async function saveWeeklyWindows() {
    setBusy(true);
    setError(null);

    try {
      const response = await staffApiFetch(`${basePath}/schedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weeklyWindows: draftWindows.map(({ dayOfWeek, startMinute, endMinute }) => ({
            dayOfWeek,
            startMinute,
            endMinute,
          })),
        }),
      });

      const payload = (await response.json()) as {
        schedule?: ScheduleView;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to save weekly schedule.");
      }

      setSchedule(payload.schedule ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function createStopSale() {
    setBusy(true);
    setError(null);

    try {
      const response = await staffApiFetch(`${basePath}/stop-sales`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: stopSaleDraft.targetType,
          targetPublicId: stopSaleDraft.targetPublicId.trim(),
          reason: stopSaleDraft.reason.trim(),
          expiresAt: stopSaleDraft.expiresAt
            ? new Date(stopSaleDraft.expiresAt).toISOString()
            : null,
        }),
      });

      const payload = (await response.json()) as {
        stopSale?: StopSaleView;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to create stop-sale.");
      }

      if (payload.stopSale) {
        setStopSales((current) => [...current, payload.stopSale!]);
      }

      setStopSaleDraft({
        targetType: "product",
        targetPublicId: "",
        reason: "",
        expiresAt: "",
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function clearStopSale(stopSaleId: string) {
    setBusy(true);
    setError(null);

    try {
      const response = await staffApiFetch(
        `${basePath}/stop-sales/${stopSaleId}/clear`,
        { method: "POST" },
      );

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to clear stop-sale.");
      }

      setStopSales((current) => current.filter((entry) => entry.id !== stopSaleId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Clear failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            void loadAvailability().catch((loadError) => {
              setError(
                loadError instanceof Error
                  ? loadError.message
                  : "Unable to load availability.",
              );
            });
          }}
          className="qos-btn" data-variant="primary"
        >
          Load availability
        </button>
        {schedule ? (
          <span
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              schedule.isOpenNow
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-900"
            }`}
          >
            {schedule.isOpenNow ? "Open now" : "Closed now"} · {schedule.timezone}
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="qos-alert" data-tone="error">
          {error}
        </p>
      ) : null}

      {schedule ? (
        <section className="qos-card" data-padding="md">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Weekly hours</h2>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                setDraftWindows((current) => [
                  ...current,
                  {
                    key: `new-${current.length}`,
                    dayOfWeek: 1,
                    startMinute: 9 * 60,
                    endMinute: 17 * 60,
                  },
                ])
              }
              className="text-sm font-medium text-zinc-700 underline-offset-4 hover:underline"
            >
              Add window
            </button>
          </div>

          <div className="space-y-3">
            {draftWindows.map((window, index) => (
              <div
                key={window.key}
                className="grid gap-3 rounded-lg border border-zinc-100 p-3 md:grid-cols-4"
              >
                <label className="text-sm">
                  Day
                  <select
                    value={window.dayOfWeek}
                    onChange={(event) =>
                      setDraftWindows((current) =>
                        current.map((entry, entryIndex) =>
                          entryIndex === index
                            ? {
                                ...entry,
                                dayOfWeek: Number.parseInt(event.target.value, 10),
                              }
                            : entry,
                        ),
                      )
                    }
                    className="qos-input"
                  >
                    {DAY_LABELS.map((label, dayOfWeek) => (
                      <option key={label} value={dayOfWeek}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Opens
                  <input
                    type="time"
                    value={minuteToTime(window.startMinute)}
                    onChange={(event) => {
                      const startMinute = timeToMinute(event.target.value);
                      if (startMinute == null) {
                        return;
                      }

                      setDraftWindows((current) =>
                        current.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, startMinute } : entry,
                        ),
                      );
                    }}
                    className="qos-input"
                  />
                </label>
                <label className="text-sm">
                  Closes
                  <input
                    type="time"
                    value={minuteToTime(window.endMinute)}
                    onChange={(event) => {
                      const endMinute = timeToMinute(event.target.value);
                      if (endMinute == null) {
                        return;
                      }

                      setDraftWindows((current) =>
                        current.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, endMinute } : entry,
                        ),
                      );
                    }}
                    className="qos-input"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() =>
                      setDraftWindows((current) =>
                        current.filter((_, entryIndex) => entryIndex !== index),
                      )
                    }
                    className="text-sm font-medium text-red-700 underline-offset-4 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => void saveWeeklyWindows()}
            className="qos-btn" data-variant="primary"
          >
            Save weekly hours
          </button>
        </section>
      ) : null}

      <section className="qos-card" data-padding="md">
        <h2 className="text-lg font-semibold">Temporary stop-sale</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            Target type
            <select
              value={stopSaleDraft.targetType}
              onChange={(event) =>
                setStopSaleDraft((current) => ({
                  ...current,
                  targetType: event.target.value as StopSaleView["targetType"],
                }))
              }
              className="qos-input"
            >
              <option value="product">Product</option>
              <option value="variant">Variant</option>
              <option value="modifier_option">Modifier option</option>
            </select>
          </label>
          <label className="text-sm">
            Target public ID
            <input
              value={stopSaleDraft.targetPublicId}
              onChange={(event) =>
                setStopSaleDraft((current) => ({
                  ...current,
                  targetPublicId: event.target.value,
                }))
              }
              className="qos-input"
            />
          </label>
          <label className="text-sm md:col-span-2">
            Reason
            <input
              value={stopSaleDraft.reason}
              onChange={(event) =>
                setStopSaleDraft((current) => ({
                  ...current,
                  reason: event.target.value,
                }))
              }
              className="qos-input"
            />
          </label>
          <label className="text-sm">
            Expires at (optional)
            <input
              type="datetime-local"
              value={stopSaleDraft.expiresAt}
              onChange={(event) =>
                setStopSaleDraft((current) => ({
                  ...current,
                  expiresAt: event.target.value,
                }))
              }
              className="qos-input"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void createStopSale()}
          className="qos-btn" data-variant="primary"
        >
          Create stop-sale
        </button>

        {stopSales.length > 0 ? (
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-100">
            {stopSales.map((stopSale) => (
              <li
                key={stopSale.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {stopSale.targetType} · {stopSale.targetPublicId}
                  </p>
                  <p className="text-zinc-600">{stopSale.reason}</p>
                  {stopSale.expiresAt ? (
                    <p className="text-zinc-500">
                      Expires {new Date(stopSale.expiresAt).toLocaleString()}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void clearStopSale(stopSale.id)}
                  className="font-medium text-zinc-700 underline-offset-4 hover:underline"
                >
                  Clear
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">No active stop-sales loaded.</p>
        )}
      </section>
    </div>
  );
}
