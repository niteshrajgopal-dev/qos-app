import { and, asc, eq, ne, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { DbClient } from "@/db/client";
import { salesChannels } from "@/db/schema";
import {
  auditActorClassFromStaffRole,
  recordTenantAuditEventInTx,
} from "@/lib/audit/tenant-audit";
import { requirePriceEditCapability } from "@/lib/catalogue/location-price-overrides";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import type { TenantDbExecutor } from "@/lib/tenant/context";
import { withTenantContext } from "@/lib/tenant/context";

/* Tenant sales-channel identities (QOS-213). A channel is a price list
   identity such as an aggregator; it is not a location, a warehouse or a
   storefront. Channels are created only by an administrator: nothing seeds
   them, and QOS never names one after a provider or a city. When a caller
   gives a workbook slot but no name, the name is the neutral slot label
   ("Aggregator 1"), never a guess. */

export const SALES_CHANNEL_KINDS = ["aggregator", "other"] as const;
export type SalesChannelKind = (typeof SALES_CHANNEL_KINDS)[number];

export const WORKBOOK_SLOTS = ["aggregator_1", "aggregator_2", "aggregator_3"] as const;
export type WorkbookSlot = (typeof WORKBOOK_SLOTS)[number];

export const WORKBOOK_SLOT_DEFAULT_NAMES: Record<WorkbookSlot, string> = {
  aggregator_1: "Aggregator 1",
  aggregator_2: "Aggregator 2",
  aggregator_3: "Aggregator 3",
};

const CHANNEL_CODE_PATTERN = /^[a-z0-9_]+$/;
const CHANNEL_CODE_MAX = 64;
const DISPLAY_NAME_MAX = 120;

export class SalesChannelError extends Error {
  readonly statusCode: number;
  readonly field?: string;
  readonly code?: string;

  constructor(message: string, statusCode = 400, field?: string, code?: string) {
    super(message);
    this.name = "SalesChannelError";
    this.statusCode = statusCode;
    this.field = field;
    this.code = code;
  }
}

export type SalesChannelView = {
  publicId: string;
  code: string;
  displayName: string;
  kind: SalesChannelKind;
  workbookSlot: WorkbookSlot | null;
  status: "active" | "archived";
  version: number;
};

export type SalesChannelsView = {
  canEdit: boolean;
  channels: SalesChannelView[];
};

export type CreateSalesChannelInput = {
  code?: unknown;
  displayName?: unknown;
  kind?: unknown;
  workbookSlot?: unknown;
};

export type UpdateSalesChannelInput = {
  expectedVersion?: unknown;
  displayName?: unknown;
  kind?: unknown;
  workbookSlot?: unknown;
  status?: unknown;
};

export function isWorkbookSlot(value: unknown): value is WorkbookSlot {
  return typeof value === "string" && (WORKBOOK_SLOTS as readonly string[]).includes(value);
}

export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  if ("code" in error && (error as { code: unknown }).code === "23505") {
    return true;
  }
  return "cause" in error && isUniqueViolation((error as { cause: unknown }).cause);
}

function parseWorkbookSlot(value: unknown): WorkbookSlot | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (!isWorkbookSlot(value)) {
    throw new SalesChannelError(
      "workbookSlot must be aggregator_1, aggregator_2, aggregator_3 or empty.",
      400,
      "workbookSlot",
    );
  }
  return value;
}

function parseKind(value: unknown, fallback: SalesChannelKind): SalesChannelKind {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string" || !(SALES_CHANNEL_KINDS as readonly string[]).includes(value)) {
    throw new SalesChannelError("kind must be aggregator or other.", 400, "kind");
  }
  return value as SalesChannelKind;
}

function parseDisplayName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new SalesChannelError("Enter a display name.", 400, "displayName");
  }
  const trimmed = value.trim();
  if (trimmed.length > DISPLAY_NAME_MAX) {
    throw new SalesChannelError(
      `Display name must be ${DISPLAY_NAME_MAX} characters or fewer.`,
      400,
      "displayName",
    );
  }
  return trimmed;
}

function codeFromName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, CHANNEL_CODE_MAX);
}

function parseCode(value: unknown): string {
  if (typeof value !== "string" || !CHANNEL_CODE_PATTERN.test(value) || value.length > CHANNEL_CODE_MAX) {
    throw new SalesChannelError(
      "Code must use lowercase letters, digits and underscores only.",
      400,
      "code",
    );
  }
  return value;
}

function generateChannelPublicId(code: string) {
  const slug = code.replace(/_/g, "-").slice(0, 24).replace(/-+$/g, "") || "channel";
  return `schan_${slug}_${randomUUID().slice(0, 8)}`;
}

export function toSalesChannelView(row: typeof salesChannels.$inferSelect): SalesChannelView {
  return {
    publicId: row.publicId,
    code: row.code,
    displayName: row.displayName,
    kind: row.kind === "other" ? "other" : "aggregator",
    workbookSlot: isWorkbookSlot(row.workbookSlot) ? row.workbookSlot : null,
    status: row.status === "archived" ? "archived" : "active",
    version: row.version,
  };
}

export async function loadSalesChannelsInTx(tx: TenantDbExecutor, tenantId: string) {
  const rows = await tx
    .select()
    .from(salesChannels)
    .where(eq(salesChannels.tenantId, tenantId))
    .orderBy(
      sql`${salesChannels.workbookSlot} asc nulls last`,
      asc(salesChannels.code),
    );
  return rows;
}

export async function loadSalesChannelByPublicIdInTx(
  tx: TenantDbExecutor,
  tenantId: string,
  channelPublicId: string,
) {
  const [row] = await tx
    .select()
    .from(salesChannels)
    .where(and(eq(salesChannels.tenantId, tenantId), eq(salesChannels.publicId, channelPublicId)))
    .limit(1);
  if (!row) {
    throw new SalesChannelError("Sales channel not found.", 404, "channelPublicId");
  }
  return row;
}

async function assertSlotFree(
  tx: TenantDbExecutor,
  tenantId: string,
  slot: WorkbookSlot,
  exceptId?: string,
) {
  const [holder] = await tx
    .select({ publicId: salesChannels.publicId })
    .from(salesChannels)
    .where(
      and(
        eq(salesChannels.tenantId, tenantId),
        eq(salesChannels.workbookSlot, slot),
        exceptId ? ne(salesChannels.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (holder) {
    throw new SalesChannelError(
      `Workbook slot ${slot} is already used by another channel.`,
      409,
      "workbookSlot",
      "workbook_slot_taken",
    );
  }
}

export async function listSalesChannels(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
): Promise<SalesChannelsView> {
  return withTenantContext(db, tenantId, async (tx) => ({
    canEdit: membership.role === "administrator",
    channels: (await loadSalesChannelsInTx(tx, tenantId)).map(toSalesChannelView),
  }));
}

export async function createSalesChannel(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  staffSubject: string,
  input: CreateSalesChannelInput,
): Promise<SalesChannelView> {
  requirePriceEditCapability(membership, "Administrator membership is required to change sales channels.");

  const workbookSlot = parseWorkbookSlot(input.workbookSlot);
  const displayName =
    input.displayName === undefined || input.displayName === null || input.displayName === ""
      ? workbookSlot
        ? WORKBOOK_SLOT_DEFAULT_NAMES[workbookSlot]
        : parseDisplayName(input.displayName)
      : parseDisplayName(input.displayName);
  const kind = parseKind(input.kind, "aggregator");
  // Without a typed code, the code follows the name ("Aggregator 1" -> aggregator_1).
  const rawCode =
    input.code === undefined || input.code === null || input.code === ""
      ? codeFromName(displayName) || (workbookSlot ?? "")
      : input.code;
  if (rawCode === "") {
    throw new SalesChannelError("Enter a code for this channel.", 400, "code");
  }
  const code = parseCode(rawCode);

  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const [codeHolder] = await tx
        .select({ id: salesChannels.id })
        .from(salesChannels)
        .where(and(eq(salesChannels.tenantId, tenantId), eq(salesChannels.code, code)))
        .limit(1);
      if (codeHolder) {
        throw new SalesChannelError(
          `Code ${code} is already used by another channel.`,
          409,
          "code",
          "channel_code_taken",
        );
      }
      if (workbookSlot) {
        await assertSlotFree(tx, tenantId, workbookSlot);
      }

      const [row] = await tx
        .insert(salesChannels)
        .values({
          tenantId,
          publicId: generateChannelPublicId(code),
          code,
          displayName,
          kind,
          workbookSlot,
        })
        .returning();

      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: staffSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: "catalogue.sales_channel.create",
        entityType: "sales_channel",
        entityPublicId: row.publicId,
        entityVersion: row.version,
        changeSummary: {
          after: { code, displayName, kind, workbookSlot, status: row.status },
        },
      });

      return toSalesChannelView(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new SalesChannelError(
        "Another channel already uses this code or workbook slot.",
        409,
        undefined,
        "sales_channel_conflict",
      );
    }
    throw error;
  }
}

export async function updateSalesChannel(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  staffSubject: string,
  channelPublicId: string,
  input: UpdateSalesChannelInput,
): Promise<SalesChannelView> {
  requirePriceEditCapability(membership, "Administrator membership is required to change sales channels.");

  if (!Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 1) {
    throw new SalesChannelError("expectedVersion is required.", 400, "expectedVersion");
  }
  const expectedVersion = input.expectedVersion as number;

  if (
    input.status !== undefined &&
    input.status !== "active" &&
    input.status !== "archived"
  ) {
    throw new SalesChannelError("status must be active or archived.", 400, "status");
  }

  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const current = await loadSalesChannelByPublicIdInTx(tx, tenantId, channelPublicId);
      if (current.version !== expectedVersion) {
        throw new SalesChannelError(
          "This channel was changed elsewhere. Reload and try again.",
          409,
          "expectedVersion",
          "stale_version",
        );
      }

      const before = toSalesChannelView(current);
      const nextStatus = (input.status as "active" | "archived" | undefined) ?? before.status;
      const archiving = before.status === "active" && nextStatus === "archived";
      const displayName =
        input.displayName === undefined ? before.displayName : parseDisplayName(input.displayName);
      const kind = parseKind(input.kind, before.kind);
      // An archived channel gives its workbook slot back so an active channel can take it.
      let workbookSlot =
        input.workbookSlot === undefined ? before.workbookSlot : parseWorkbookSlot(input.workbookSlot);
      if (nextStatus === "archived") {
        if (input.workbookSlot !== undefined && workbookSlot !== null) {
          throw new SalesChannelError(
            "An archived channel cannot hold a workbook slot.",
            400,
            "workbookSlot",
          );
        }
        workbookSlot = null;
      }
      if (workbookSlot && workbookSlot !== before.workbookSlot) {
        await assertSlotFree(tx, tenantId, workbookSlot, current.id);
      }

      const [row] = await tx
        .update(salesChannels)
        .set({
          displayName,
          kind,
          workbookSlot,
          status: nextStatus,
          version: expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(salesChannels.tenantId, tenantId),
            eq(salesChannels.id, current.id),
            eq(salesChannels.version, expectedVersion),
          ),
        )
        .returning();
      if (!row) {
        throw new SalesChannelError(
          "This channel was changed elsewhere. Reload and try again.",
          409,
          "expectedVersion",
          "stale_version",
        );
      }

      const after = toSalesChannelView(row);
      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: staffSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: archiving ? "catalogue.sales_channel.archive" : "catalogue.sales_channel.update",
        entityType: "sales_channel",
        entityPublicId: row.publicId,
        entityVersion: row.version,
        changeSummary: {
          before: {
            displayName: before.displayName,
            kind: before.kind,
            workbookSlot: before.workbookSlot,
            status: before.status,
          },
          after: {
            displayName: after.displayName,
            kind: after.kind,
            workbookSlot: after.workbookSlot,
            status: after.status,
          },
        },
      });

      return after;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new SalesChannelError(
        "Another channel already uses this workbook slot.",
        409,
        "workbookSlot",
        "workbook_slot_taken",
      );
    }
    throw error;
  }
}
