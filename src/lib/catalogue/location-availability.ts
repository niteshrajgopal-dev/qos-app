import { and, asc, eq, isNull } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  catalogueModifierOptions,
  catalogueProducts,
  catalogueVariants,
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
import {
  validateCreateStopSaleInput,
  validateScheduleExceptionInput,
  validateWeeklyScheduleWindowsInput,
  type ScheduleExceptionInput,
  type WeeklyScheduleWindowInput,
} from "@/lib/catalogue/availability-validation";
import {
  auditActorClassFromStaffRole,
  recordTenantAuditEventInTx,
} from "@/lib/audit/tenant-audit";
import { CatalogueValidationError } from "@/lib/catalogue/validation";
import { requireAdministratorMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

export class LocationAvailabilityError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "LocationAvailabilityError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

export type LocationScheduleView = {
  locationPublicId: string;
  locationName: string;
  timezone: string;
  isOpenNow: boolean;
  weeklyWindows: WeeklyScheduleWindow[];
  exceptions: Array<
    ScheduleException & {
      id: string;
      label: string | null;
    }
  >;
};

export type StopSaleView = {
  id: string;
  targetType: "product" | "variant" | "modifier_option";
  targetPublicId: string;
  reason: string;
  startsAt: string;
  expiresAt: string | null;
  createdBySubject: string;
  clearedAt: string | null;
  clearedBySubject: string | null;
};

async function resolveLocation(
  tx: DbClient,
  tenantId: string,
  locationPublicId: string,
) {
  const [location] = await tx
    .select({
      id: locations.id,
      publicId: locations.publicId,
      name: locations.name,
      timezone: locations.timezone,
    })
    .from(locations)
    .where(
      and(
        eq(locations.tenantId, tenantId),
        eq(locations.publicId, locationPublicId),
      ),
    )
    .limit(1);

  if (!location) {
    throw new LocationAvailabilityError("Location not found.", 404, "locationPublicId");
  }

  return location;
}

async function loadScheduleForLocation(
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
    )
    .orderBy(
      asc(locationWeeklyScheduleWindows.dayOfWeek),
      asc(locationWeeklyScheduleWindows.startMinute),
    );

  const exceptions = await tx
    .select({
      id: locationScheduleExceptions.id,
      exceptionDate: locationScheduleExceptions.exceptionDate,
      closedAllDay: locationScheduleExceptions.closedAllDay,
      startMinute: locationScheduleExceptions.startMinute,
      endMinute: locationScheduleExceptions.endMinute,
      priority: locationScheduleExceptions.priority,
      label: locationScheduleExceptions.label,
    })
    .from(locationScheduleExceptions)
    .where(
      and(
        eq(locationScheduleExceptions.tenantId, tenantId),
        eq(locationScheduleExceptions.locationId, locationId),
      ),
    )
    .orderBy(
      asc(locationScheduleExceptions.exceptionDate),
      asc(locationScheduleExceptions.priority),
    );

  return {
    weeklyWindows: weeklyWindows as WeeklyScheduleWindow[],
    exceptions,
  };
}

async function assertStopSaleTargetExists(
  tx: DbClient,
  tenantId: string,
  targetType: "product" | "variant" | "modifier_option",
  targetPublicId: string,
) {
  if (targetType === "product") {
    const [product] = await tx
      .select({ publicId: catalogueProducts.publicId })
      .from(catalogueProducts)
      .where(
        and(
          eq(catalogueProducts.tenantId, tenantId),
          eq(catalogueProducts.publicId, targetPublicId),
        ),
      )
      .limit(1);

    if (!product) {
      throw new LocationAvailabilityError(
        "Product not found for stop-sale target.",
        404,
        "targetPublicId",
      );
    }

    return;
  }

  if (targetType === "variant") {
    const [variant] = await tx
      .select({ publicId: catalogueVariants.publicId })
      .from(catalogueVariants)
      .where(
        and(
          eq(catalogueVariants.tenantId, tenantId),
          eq(catalogueVariants.publicId, targetPublicId),
        ),
      )
      .limit(1);

    if (!variant) {
      throw new LocationAvailabilityError(
        "Variant not found for stop-sale target.",
        404,
        "targetPublicId",
      );
    }

    return;
  }

  const [option] = await tx
    .select({ publicId: catalogueModifierOptions.publicId })
    .from(catalogueModifierOptions)
    .where(
      and(
        eq(catalogueModifierOptions.tenantId, tenantId),
        eq(catalogueModifierOptions.publicId, targetPublicId),
      ),
    )
    .limit(1);

  if (!option) {
    throw new LocationAvailabilityError(
      "Modifier option not found for stop-sale target.",
      404,
      "targetPublicId",
    );
  }
}

function mapStopSaleRow(row: typeof locationItemStopSales.$inferSelect): StopSaleView {
  return {
    id: row.id,
    targetType: row.targetType,
    targetPublicId: row.targetPublicId,
    reason: row.reason,
    startsAt: row.startsAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdBySubject: row.createdBySubject,
    clearedAt: row.clearedAt?.toISOString() ?? null,
    clearedBySubject: row.clearedBySubject,
  };
}

export async function getLocationScheduleView(
  db: DbClient,
  tenantId: string,
  adminSubject: string,
  locationPublicId: string,
  at: Date = new Date(),
): Promise<LocationScheduleView> {
  await requireAdministratorMembership(db, tenantId, adminSubject);

  return withTenantContext(db, tenantId, async (tx) => {
    const location = await resolveLocation(tx, tenantId, locationPublicId);
    const schedule = await loadScheduleForLocation(tx, tenantId, location.id);

    return {
      locationPublicId: location.publicId,
      locationName: location.name,
      timezone: location.timezone,
      isOpenNow: isLocationOpenAt({
        timeZone: location.timezone,
        at,
        weeklyWindows: schedule.weeklyWindows,
        exceptions: schedule.exceptions,
      }),
      weeklyWindows: schedule.weeklyWindows,
      exceptions: schedule.exceptions,
    };
  });
}

export async function replaceLocationWeeklySchedule(
  db: DbClient,
  tenantId: string,
  adminSubject: string,
  locationPublicId: string,
  weeklyWindowsInput: WeeklyScheduleWindowInput[],
) {
  const membership = await requireAdministratorMembership(
    db,
    tenantId,
    adminSubject,
  );
  const weeklyWindows = validateWeeklyScheduleWindowsInput(weeklyWindowsInput);

  return withTenantContext(db, tenantId, async (tx) => {
    const location = await resolveLocation(tx, tenantId, locationPublicId);

    await tx
      .delete(locationWeeklyScheduleWindows)
      .where(
        and(
          eq(locationWeeklyScheduleWindows.tenantId, tenantId),
          eq(locationWeeklyScheduleWindows.locationId, location.id),
        ),
      );

    if (weeklyWindows.length > 0) {
      await tx.insert(locationWeeklyScheduleWindows).values(
        weeklyWindows.map((window) => ({
          tenantId,
          locationId: location.id,
          dayOfWeek: window.dayOfWeek,
          startMinute: window.startMinute,
          endMinute: window.endMinute,
        })),
      );
    }

    await recordTenantAuditEventInTx(tx, {
      tenantId,
      locationId: location.id,
      actorSubject: adminSubject,
      actorClass: auditActorClassFromStaffRole(membership.role),
      action: "location.schedule.replace",
      entityType: "location",
      entityPublicId: location.publicId,
      changeSummary: {
        windowCount: weeklyWindows.length,
        weeklyWindows,
      },
    });

    return getLocationScheduleView(db, tenantId, adminSubject, locationPublicId);
  });
}

export async function upsertLocationScheduleException(
  db: DbClient,
  tenantId: string,
  adminSubject: string,
  locationPublicId: string,
  input: ScheduleExceptionInput,
) {
  const membership = await requireAdministratorMembership(
    db,
    tenantId,
    adminSubject,
  );
  const validated = validateScheduleExceptionInput(input);

  return withTenantContext(db, tenantId, async (tx) => {
    const location = await resolveLocation(tx, tenantId, locationPublicId);

    const [existing] = await tx
      .select({ id: locationScheduleExceptions.id })
      .from(locationScheduleExceptions)
      .where(
        and(
          eq(locationScheduleExceptions.tenantId, tenantId),
          eq(locationScheduleExceptions.locationId, location.id),
          eq(locationScheduleExceptions.exceptionDate, validated.exceptionDate),
          eq(locationScheduleExceptions.priority, validated.priority),
        ),
      )
      .limit(1);

    let exceptionId: string;

    if (existing) {
      await tx
        .update(locationScheduleExceptions)
        .set({
          closedAllDay: validated.closedAllDay,
          startMinute: validated.closedAllDay ? null : validated.startMinute,
          endMinute: validated.closedAllDay ? null : validated.endMinute,
          label: validated.label ?? null,
          updatedAt: new Date(),
        })
        .where(eq(locationScheduleExceptions.id, existing.id));

      exceptionId = existing.id;
    } else {
      const [created] = await tx
        .insert(locationScheduleExceptions)
        .values({
          tenantId,
          locationId: location.id,
          exceptionDate: validated.exceptionDate,
          closedAllDay: validated.closedAllDay,
          startMinute: validated.closedAllDay ? null : validated.startMinute,
          endMinute: validated.closedAllDay ? null : validated.endMinute,
          priority: validated.priority,
          label: validated.label ?? null,
        })
        .returning({ id: locationScheduleExceptions.id });

      exceptionId = created.id;
    }

    await recordTenantAuditEventInTx(tx, {
      tenantId,
      locationId: location.id,
      actorSubject: adminSubject,
      actorClass: auditActorClassFromStaffRole(membership.role),
      action: "location.schedule.exception.upsert",
      entityType: "location_schedule_exception",
      entityPublicId: exceptionId,
      changeSummary: {
        locationPublicId: location.publicId,
        exception: validated,
      },
    });

    return getLocationScheduleView(db, tenantId, adminSubject, locationPublicId);
  });
}

export async function deleteLocationScheduleException(
  db: DbClient,
  tenantId: string,
  adminSubject: string,
  locationPublicId: string,
  exceptionId: string,
) {
  const membership = await requireAdministratorMembership(
    db,
    tenantId,
    adminSubject,
  );

  return withTenantContext(db, tenantId, async (tx) => {
    const location = await resolveLocation(tx, tenantId, locationPublicId);

    const [existing] = await tx
      .select({ id: locationScheduleExceptions.id })
      .from(locationScheduleExceptions)
      .where(
        and(
          eq(locationScheduleExceptions.tenantId, tenantId),
          eq(locationScheduleExceptions.locationId, location.id),
          eq(locationScheduleExceptions.id, exceptionId),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new LocationAvailabilityError(
        "Schedule exception not found.",
        404,
        "exceptionId",
      );
    }

    await tx
      .delete(locationScheduleExceptions)
      .where(eq(locationScheduleExceptions.id, existing.id));

    await recordTenantAuditEventInTx(tx, {
      tenantId,
      locationId: location.id,
      actorSubject: adminSubject,
      actorClass: auditActorClassFromStaffRole(membership.role),
      action: "location.schedule.exception.delete",
      entityType: "location_schedule_exception",
      entityPublicId: exceptionId,
      changeSummary: {
        locationPublicId: location.publicId,
      },
    });

    return getLocationScheduleView(db, tenantId, adminSubject, locationPublicId);
  });
}

export async function listLocationStopSales(
  db: DbClient,
  tenantId: string,
  adminSubject: string,
  locationPublicId: string,
  includeCleared = false,
) {
  await requireAdministratorMembership(db, tenantId, adminSubject);

  return withTenantContext(db, tenantId, async (tx) => {
    const location = await resolveLocation(tx, tenantId, locationPublicId);

    const rows = await tx
      .select()
      .from(locationItemStopSales)
      .where(
        and(
          eq(locationItemStopSales.tenantId, tenantId),
          eq(locationItemStopSales.locationId, location.id),
          ...(includeCleared ? [] : [isNull(locationItemStopSales.clearedAt)]),
        ),
      )
      .orderBy(asc(locationItemStopSales.startsAt));

    return {
      locationPublicId: location.publicId,
      stopSales: rows.map(mapStopSaleRow),
    };
  });
}

export async function createLocationStopSale(
  db: DbClient,
  tenantId: string,
  adminSubject: string,
  locationPublicId: string,
  input: Parameters<typeof validateCreateStopSaleInput>[0],
) {
  const membership = await requireAdministratorMembership(
    db,
    tenantId,
    adminSubject,
  );

  let validated;
  try {
    validated = validateCreateStopSaleInput(input);
  } catch (error) {
    if (error instanceof CatalogueValidationError) {
      throw new LocationAvailabilityError(error.message, 400, error.field);
    }
    throw error;
  }

  return withTenantContext(db, tenantId, async (tx) => {
    const location = await resolveLocation(tx, tenantId, locationPublicId);
    await assertStopSaleTargetExists(
      tx,
      tenantId,
      validated.targetType,
      validated.targetPublicId,
    );

    const startsAt = validated.startsAt ?? new Date();

    const [activeDuplicate] = await tx
      .select({ id: locationItemStopSales.id })
      .from(locationItemStopSales)
      .where(
        and(
          eq(locationItemStopSales.tenantId, tenantId),
          eq(locationItemStopSales.locationId, location.id),
          eq(locationItemStopSales.targetType, validated.targetType),
          eq(locationItemStopSales.targetPublicId, validated.targetPublicId),
          isNull(locationItemStopSales.clearedAt),
        ),
      )
      .limit(1);

    if (activeDuplicate) {
      throw new LocationAvailabilityError(
        "An active stop-sale already exists for this target.",
        409,
        "targetPublicId",
      );
    }

    const [created] = await tx
      .insert(locationItemStopSales)
      .values({
        tenantId,
        locationId: location.id,
        targetType: validated.targetType,
        targetPublicId: validated.targetPublicId,
        reason: validated.reason,
        startsAt,
        expiresAt: validated.expiresAt,
        createdBySubject: adminSubject,
      })
      .returning();

    await recordTenantAuditEventInTx(tx, {
      tenantId,
      locationId: location.id,
      actorSubject: adminSubject,
      actorClass: auditActorClassFromStaffRole(membership.role),
      action: "location.stop_sale.create",
      entityType: "location_stop_sale",
      entityPublicId: created.id,
      changeSummary: {
        locationPublicId: location.publicId,
        targetType: validated.targetType,
        targetPublicId: validated.targetPublicId,
        reason: validated.reason,
        startsAt: startsAt.toISOString(),
        expiresAt: validated.expiresAt?.toISOString() ?? null,
      },
    });

    return mapStopSaleRow(created);
  });
}

export async function clearLocationStopSale(
  db: DbClient,
  tenantId: string,
  adminSubject: string,
  locationPublicId: string,
  stopSaleId: string,
) {
  const membership = await requireAdministratorMembership(
    db,
    tenantId,
    adminSubject,
  );

  return withTenantContext(db, tenantId, async (tx) => {
    const location = await resolveLocation(tx, tenantId, locationPublicId);

    const [existing] = await tx
      .select()
      .from(locationItemStopSales)
      .where(
        and(
          eq(locationItemStopSales.tenantId, tenantId),
          eq(locationItemStopSales.locationId, location.id),
          eq(locationItemStopSales.id, stopSaleId),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new LocationAvailabilityError(
        "Stop-sale not found.",
        404,
        "stopSaleId",
      );
    }

    if (existing.clearedAt) {
      return mapStopSaleRow(existing);
    }

    const clearedAt = new Date();
    const [updated] = await tx
      .update(locationItemStopSales)
      .set({
        clearedAt,
        clearedBySubject: adminSubject,
        updatedAt: clearedAt,
      })
      .where(eq(locationItemStopSales.id, existing.id))
      .returning();

    await recordTenantAuditEventInTx(tx, {
      tenantId,
      locationId: location.id,
      actorSubject: adminSubject,
      actorClass: auditActorClassFromStaffRole(membership.role),
      action: "location.stop_sale.clear",
      entityType: "location_stop_sale",
      entityPublicId: stopSaleId,
      changeSummary: {
        locationPublicId: location.publicId,
        targetType: existing.targetType,
        targetPublicId: existing.targetPublicId,
        clearedAt: clearedAt.toISOString(),
      },
    });

    return mapStopSaleRow(updated);
  });
}
