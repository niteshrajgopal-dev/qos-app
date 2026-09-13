import { and, eq, inArray, isNull, lte, or, gt } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  locationItemStopSales,
  locationScheduleExceptions,
  locationWeeklyScheduleWindows,
  locations,
} from "@/db/schema";
import {
  isLocationOpenAt,
  type ScheduleException,
  type WeeklyScheduleWindow,
} from "@/lib/catalogue/availability-schedule";

export type ItemEligibilityTargetType = "product" | "variant" | "modifier_option";

export type ItemEligibilityResult = {
  available: boolean;
  reason:
    | "available"
    | "location_closed"
    | "stop_sale"
    | "stop_sale_expired"
    | null;
  source: "schedule" | "stop_sale" | null;
  stopSaleReason: string | null;
  stopSaleExpiresAt: string | null;
};

export class ItemEligibilityError extends Error {
  readonly statusCode: number;
  readonly field?: string;
  readonly eligibility: ItemEligibilityResult;

  constructor(
    message: string,
    eligibility: ItemEligibilityResult,
    statusCode = 400,
    field?: string,
  ) {
    super(message);
    this.name = "ItemEligibilityError";
    this.statusCode = statusCode;
    this.field = field;
    this.eligibility = eligibility;
  }
}

async function loadLocationSchedule(
  tx: DbClient,
  tenantId: string,
  locationId: string,
) {
  const weeklyWindows = await tx
    .select({
      dayOfWeek: locationWeeklyScheduleWindows.dayOfWeek,
      startMinute: locationWeeklyScheduleWindows.startMinute,
      endMinute: locationWeeklyScheduleWindows.endMinute,
    })
    .from(locationWeeklyScheduleWindows)
    .where(
      and(
        eq(locationWeeklyScheduleWindows.tenantId, tenantId),
        eq(locationWeeklyScheduleWindows.locationId, locationId),
      ),
    );

  const exceptions = await tx
    .select({
      exceptionDate: locationScheduleExceptions.exceptionDate,
      closedAllDay: locationScheduleExceptions.closedAllDay,
      startMinute: locationScheduleExceptions.startMinute,
      endMinute: locationScheduleExceptions.endMinute,
      priority: locationScheduleExceptions.priority,
    })
    .from(locationScheduleExceptions)
    .where(
      and(
        eq(locationScheduleExceptions.tenantId, tenantId),
        eq(locationScheduleExceptions.locationId, locationId),
      ),
    );

  return {
    weeklyWindows: weeklyWindows as WeeklyScheduleWindow[],
    exceptions: exceptions as ScheduleException[],
  };
}

async function expireDueStopSales(
  tx: DbClient,
  tenantId: string,
  locationId: string,
  at: Date,
) {
  await tx
    .update(locationItemStopSales)
    .set({
      clearedAt: at,
      clearedBySubject: "system:expiry",
      updatedAt: at,
    })
    .where(
      and(
        eq(locationItemStopSales.tenantId, tenantId),
        eq(locationItemStopSales.locationId, locationId),
        isNull(locationItemStopSales.clearedAt),
        lte(locationItemStopSales.startsAt, at),
        lte(locationItemStopSales.expiresAt, at),
      ),
    );
}

async function loadActiveStopSale(
  tx: DbClient,
  tenantId: string,
  locationId: string,
  targetType: ItemEligibilityTargetType,
  targetPublicId: string,
  at: Date,
) {
  const [stopSale] = await tx
    .select()
    .from(locationItemStopSales)
    .where(
      and(
        eq(locationItemStopSales.tenantId, tenantId),
        eq(locationItemStopSales.locationId, locationId),
        eq(locationItemStopSales.targetType, targetType),
        eq(locationItemStopSales.targetPublicId, targetPublicId),
        isNull(locationItemStopSales.clearedAt),
        lte(locationItemStopSales.startsAt, at),
        or(
          isNull(locationItemStopSales.expiresAt),
          gt(locationItemStopSales.expiresAt, at),
        ),
      ),
    )
    .limit(1);

  return stopSale ?? null;
}

export async function resolveItemEligibility(
  tx: DbClient,
  input: {
    tenantId: string;
    locationId: string;
    targetType: ItemEligibilityTargetType;
    targetPublicId: string;
    at?: Date;
  },
): Promise<ItemEligibilityResult> {
  const at = input.at ?? new Date();

  const [location] = await tx
    .select({ timezone: locations.timezone })
    .from(locations)
    .where(
      and(
        eq(locations.tenantId, input.tenantId),
        eq(locations.id, input.locationId),
      ),
    )
    .limit(1);

  if (!location) {
    throw new ItemEligibilityError(
      "Location not found.",
      {
        available: false,
        reason: "location_closed",
        source: null,
        stopSaleReason: null,
        stopSaleExpiresAt: null,
      },
      404,
      "locationId",
    );
  }

  await expireDueStopSales(tx, input.tenantId, input.locationId, at);

  const schedule = await loadLocationSchedule(
    tx,
    input.tenantId,
    input.locationId,
  );
  const open = isLocationOpenAt({
    timeZone: location.timezone,
    at,
    weeklyWindows: schedule.weeklyWindows,
    exceptions: schedule.exceptions,
  });

  if (!open) {
    return {
      available: false,
      reason: "location_closed",
      source: "schedule",
      stopSaleReason: null,
      stopSaleExpiresAt: null,
    };
  }

  const stopSale = await loadActiveStopSale(
    tx,
    input.tenantId,
    input.locationId,
    input.targetType,
    input.targetPublicId,
    at,
  );

  if (stopSale) {
    return {
      available: false,
      reason: "stop_sale",
      source: "stop_sale",
      stopSaleReason: stopSale.reason,
      stopSaleExpiresAt: stopSale.expiresAt?.toISOString() ?? null,
    };
  }

  return {
    available: true,
    reason: "available",
    source: null,
    stopSaleReason: null,
    stopSaleExpiresAt: null,
  };
}

const unavailableResult = (
  reason: ItemEligibilityResult["reason"],
  source: ItemEligibilityResult["source"],
  stopSaleReason: string | null = null,
  stopSaleExpiresAt: string | null = null,
): ItemEligibilityResult => ({
  available: false,
  reason,
  source,
  stopSaleReason,
  stopSaleExpiresAt,
});

const availableResult: ItemEligibilityResult = {
  available: true,
  reason: "available",
  source: null,
  stopSaleReason: null,
  stopSaleExpiresAt: null,
};

export async function resolveProductEligibilityMap(
  tx: DbClient,
  input: {
    tenantId: string;
    locationId: string;
    productPublicIds: string[];
    at?: Date;
  },
): Promise<Map<string, ItemEligibilityResult>> {
  const at = input.at ?? new Date();
  const uniqueProductPublicIds = [...new Set(input.productPublicIds)];
  const results = new Map<string, ItemEligibilityResult>();

  if (uniqueProductPublicIds.length === 0) {
    return results;
  }

  const [location] = await tx
    .select({ timezone: locations.timezone })
    .from(locations)
    .where(
      and(
        eq(locations.tenantId, input.tenantId),
        eq(locations.id, input.locationId),
      ),
    )
    .limit(1);

  if (!location) {
    for (const productPublicId of uniqueProductPublicIds) {
      results.set(
        productPublicId,
        unavailableResult("location_closed", null),
      );
    }

    return results;
  }

  await expireDueStopSales(tx, input.tenantId, input.locationId, at);

  const schedule = await loadLocationSchedule(
    tx,
    input.tenantId,
    input.locationId,
  );
  const open = isLocationOpenAt({
    timeZone: location.timezone,
    at,
    weeklyWindows: schedule.weeklyWindows,
    exceptions: schedule.exceptions,
  });

  if (!open) {
    for (const productPublicId of uniqueProductPublicIds) {
      results.set(
        productPublicId,
        unavailableResult("location_closed", "schedule"),
      );
    }

    return results;
  }

  const stopSales = await tx
    .select()
    .from(locationItemStopSales)
    .where(
      and(
        eq(locationItemStopSales.tenantId, input.tenantId),
        eq(locationItemStopSales.locationId, input.locationId),
        eq(locationItemStopSales.targetType, "product"),
        inArray(locationItemStopSales.targetPublicId, uniqueProductPublicIds),
        isNull(locationItemStopSales.clearedAt),
        lte(locationItemStopSales.startsAt, at),
        or(
          isNull(locationItemStopSales.expiresAt),
          gt(locationItemStopSales.expiresAt, at),
        ),
      ),
    );

  const stopSaleByProduct = new Map(
    stopSales.map((stopSale) => [stopSale.targetPublicId, stopSale]),
  );

  for (const productPublicId of uniqueProductPublicIds) {
    const stopSale = stopSaleByProduct.get(productPublicId);
    if (stopSale) {
      results.set(
        productPublicId,
        unavailableResult(
          "stop_sale",
          "stop_sale",
          stopSale.reason,
          stopSale.expiresAt?.toISOString() ?? null,
        ),
      );
      continue;
    }

    results.set(productPublicId, availableResult);
  }

  return results;
}

export async function assertProductEligibleAtLocation(
  tx: DbClient,
  input: {
    tenantId: string;
    locationId: string;
    productPublicId: string;
    at?: Date;
  },
) {
  const eligibility = await resolveItemEligibility(tx, {
    tenantId: input.tenantId,
    locationId: input.locationId,
    targetType: "product",
    targetPublicId: input.productPublicId,
    at: input.at,
  });

  if (!eligibility.available) {
    const message =
      eligibility.reason === "stop_sale"
        ? eligibility.stopSaleReason ?? "Product is temporarily unavailable."
        : "Location is closed for ordering at this time.";

    throw new ItemEligibilityError(message, eligibility, 400, "productPublicId");
  }

  return eligibility;
}
