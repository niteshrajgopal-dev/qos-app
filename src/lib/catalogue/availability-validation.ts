import {
  assertValidScheduleException,
  assertValidWeeklyWindow,
  AvailabilityScheduleError,
  type ScheduleException,
  type WeeklyScheduleWindow,
} from "@/lib/catalogue/availability-schedule";
import { CatalogueValidationError } from "@/lib/catalogue/validation";

export type StopSaleTargetType = "product" | "variant" | "modifier_option";

export type WeeklyScheduleWindowInput = WeeklyScheduleWindow;

export type ScheduleExceptionInput = ScheduleException & {
  label?: string | null;
};

export type CreateStopSaleInput = {
  targetType: StopSaleTargetType;
  targetPublicId: string;
  reason: string;
  startsAt?: string;
  expiresAt?: string | null;
};

function mapScheduleError(error: unknown): never {
  if (error instanceof AvailabilityScheduleError) {
    throw new CatalogueValidationError(error.message, error.field);
  }

  throw error;
}

export function validateWeeklyScheduleWindowsInput(
  windows: WeeklyScheduleWindowInput[],
) {
  if (!Array.isArray(windows)) {
    throw new CatalogueValidationError(
      "weeklyWindows must be an array.",
      "weeklyWindows",
    );
  }

  for (const [index, window] of windows.entries()) {
    try {
      assertValidWeeklyWindow(window);
    } catch (error) {
      if (error instanceof AvailabilityScheduleError) {
        throw new CatalogueValidationError(
          error.message,
          error.field ?? `weeklyWindows[${index}]`,
        );
      }

      throw error;
    }
  }

  return windows;
}

export function validateScheduleExceptionInput(input: ScheduleExceptionInput) {
  try {
    assertValidScheduleException(input);
  } catch (error) {
    mapScheduleError(error);
  }

  if (input.label != null && input.label.length > 200) {
    throw new CatalogueValidationError(
      "label must be 200 characters or fewer.",
      "label",
    );
  }

  return input;
}

export function validateCreateStopSaleInput(input: CreateStopSaleInput) {
  if (
    input.targetType !== "product" &&
    input.targetType !== "variant" &&
    input.targetType !== "modifier_option"
  ) {
    throw new CatalogueValidationError(
      "targetType must be product, variant, or modifier_option.",
      "targetType",
    );
  }

  if (
    typeof input.targetPublicId !== "string" ||
    input.targetPublicId.trim().length === 0
  ) {
    throw new CatalogueValidationError(
      "targetPublicId is required.",
      "targetPublicId",
    );
  }

  if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
    throw new CatalogueValidationError("reason is required.", "reason");
  }

  if (input.reason.trim().length > 500) {
    throw new CatalogueValidationError(
      "reason must be 500 characters or fewer.",
      "reason",
    );
  }

  let startsAt: Date | undefined;
  if (input.startsAt != null) {
    startsAt = new Date(input.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      throw new CatalogueValidationError(
        "startsAt must be a valid ISO timestamp.",
        "startsAt",
      );
    }
  }

  let expiresAt: Date | null = null;
  if (input.expiresAt != null) {
    expiresAt = new Date(input.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new CatalogueValidationError(
        "expiresAt must be a valid ISO timestamp.",
        "expiresAt",
      );
    }
  }

  if (startsAt && expiresAt && expiresAt <= startsAt) {
    throw new CatalogueValidationError(
      "expiresAt must be after startsAt.",
      "expiresAt",
    );
  }

  return {
    targetType: input.targetType,
    targetPublicId: input.targetPublicId.trim(),
    reason: input.reason.trim(),
    startsAt,
    expiresAt,
  };
}
