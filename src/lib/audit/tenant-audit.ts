import { randomUUID } from "node:crypto";

import { and, desc, eq, gte, lte, lt, or } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { tenantAuditEvents } from "@/db/schema";
import type { TenantDbExecutor } from "@/lib/tenant/context";

export type AuditActorClass =
  | "staff_administrator"
  | "staff_user"
  | "operator"
  | "system";

export function auditActorClassFromStaffRole(
  role: "administrator" | "user",
): AuditActorClass {
  return role === "administrator" ? "staff_administrator" : "staff_user";
}

export type TenantAuditEventView = {
  id: string;
  tenantId: string;
  locationId: string | null;
  actorSubject: string;
  actorClass: AuditActorClass;
  action: string;
  entityType: string;
  entityPublicId: string;
  entityVersion: number | null;
  correlationId: string;
  changeSummary: Record<string, unknown>;
  occurredAt: string;
};

export type TenantAuditEventsPage = {
  events: TenantAuditEventView[];
  nextCursor: {
    occurredAt: string;
    id: string;
  } | null;
};

export type RecordTenantAuditEventInput = {
  tenantId: string;
  locationId?: string | null;
  actorSubject: string;
  actorClass: AuditActorClass;
  action: string;
  entityType: string;
  entityPublicId: string;
  entityVersion?: number | null;
  correlationId?: string;
  changeSummary: Record<string, unknown>;
};

const SENSITIVE_KEY_PATTERN =
  /password|secret|token|credential|api[_-]?key|authorization|private[_-]?key/i;

const AUDIT_CORRELATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveAuditCorrelationId(correlationId?: string) {
  if (!correlationId?.trim()) {
    return randomUUID();
  }

  const trimmed = correlationId.trim();
  if (!AUDIT_CORRELATION_ID_PATTERN.test(trimmed)) {
    throw new Error("correlationId must be a valid UUID.");
  }

  return trimmed;
}

export function sanitizeAuditChangeSummary(
  value: unknown,
): Record<string, unknown> | unknown[] | string | number | boolean | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeAuditChangeSummary(entry));
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      sanitized[key] = "[redacted]";
      continue;
    }

    sanitized[key] = sanitizeAuditChangeSummary(nestedValue);
  }

  return sanitized;
}

export function summarizeStorefrontThemeDraft(
  theme: Record<string, unknown> | null | undefined,
) {
  if (!theme) {
    return null;
  }

  const colors =
    theme.colors && typeof theme.colors === "object"
      ? Object.keys(theme.colors as Record<string, unknown>)
      : [];
  const typography =
    theme.typography && typeof theme.typography === "object"
      ? theme.typography
      : null;
  const logo =
    theme.logo && typeof theme.logo === "object"
      ? (theme.logo as Record<string, unknown>).publicDerivativeId ?? null
      : null;

  return sanitizeAuditChangeSummary({
    schemaVersion: theme.schemaVersion ?? null,
    preset: theme.preset ?? null,
    colorTokens: colors,
    typography,
    logoPublicDerivativeId: logo,
  }) as Record<string, unknown>;
}

export function summarizeStorefrontContentBlocks(
  blocks: Array<Record<string, unknown>> | null | undefined,
) {
  if (!blocks) {
    return null;
  }

  return sanitizeAuditChangeSummary({
    blockCount: blocks.length,
    blocks: blocks.map((block) => ({
      id: block.id,
      type: block.type,
      visible: block.visible ?? true,
    })),
  }) as Record<string, unknown>;
}

export async function recordTenantAuditEventInTx(
  tx: TenantDbExecutor,
  input: RecordTenantAuditEventInput,
) {
  const changeSummary = sanitizeAuditChangeSummary(
    input.changeSummary,
  ) as Record<string, unknown>;

  const [event] = await tx
    .insert(tenantAuditEvents)
    .values({
      tenantId: input.tenantId,
      locationId: input.locationId ?? null,
      actorSubject: input.actorSubject.trim(),
      actorClass: input.actorClass,
      action: input.action,
      entityType: input.entityType,
      entityPublicId: input.entityPublicId,
      entityVersion: input.entityVersion ?? null,
      correlationId: resolveAuditCorrelationId(input.correlationId),
      changeSummary,
    })
    .returning();

  return event;
}

export type ListTenantAuditEventsInput = {
  entityType?: string;
  entityPublicId?: string;
  action?: string;
  actorSubject?: string;
  occurredAfter?: Date;
  occurredBefore?: Date;
  cursorOccurredAt?: Date;
  cursorId?: string;
  limit?: number;
};

function toAuditEventView(
  row: typeof tenantAuditEvents.$inferSelect,
): TenantAuditEventView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    locationId: row.locationId,
    actorSubject: row.actorSubject,
    actorClass: row.actorClass,
    action: row.action,
    entityType: row.entityType,
    entityPublicId: row.entityPublicId,
    entityVersion: row.entityVersion,
    correlationId: row.correlationId,
    changeSummary: row.changeSummary as Record<string, unknown>,
    occurredAt: row.occurredAt.toISOString(),
  };
}

export async function listTenantAuditEventsInTx(
  tx: TenantDbExecutor,
  tenantId: string,
  input: ListTenantAuditEventsInput = {},
): Promise<TenantAuditEventsPage> {
  const filters = [eq(tenantAuditEvents.tenantId, tenantId)];

  if (input.entityType) {
    filters.push(eq(tenantAuditEvents.entityType, input.entityType));
  }

  if (input.entityPublicId) {
    filters.push(eq(tenantAuditEvents.entityPublicId, input.entityPublicId));
  }

  if (input.action) {
    filters.push(eq(tenantAuditEvents.action, input.action));
  }

  if (input.actorSubject) {
    filters.push(eq(tenantAuditEvents.actorSubject, input.actorSubject));
  }

  if (input.occurredAfter) {
    filters.push(gte(tenantAuditEvents.occurredAt, input.occurredAfter));
  }

  if (input.occurredBefore) {
    filters.push(lte(tenantAuditEvents.occurredAt, input.occurredBefore));
  }

  if (input.cursorOccurredAt && input.cursorId) {
    filters.push(
      or(
        lt(tenantAuditEvents.occurredAt, input.cursorOccurredAt),
        and(
          eq(tenantAuditEvents.occurredAt, input.cursorOccurredAt),
          lt(tenantAuditEvents.id, input.cursorId),
        ),
      )!,
    );
  }

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

  const rows = await tx
    .select()
    .from(tenantAuditEvents)
    .where(and(...filters))
    .orderBy(desc(tenantAuditEvents.occurredAt), desc(tenantAuditEvents.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = pageRows.at(-1);

  return {
    events: pageRows.map(toAuditEventView),
    nextCursor:
      hasMore && lastRow
        ? {
            occurredAt: lastRow.occurredAt.toISOString(),
            id: lastRow.id,
          }
        : null,
  };
}

export async function listTenantAuditEvents(
  db: DbClient,
  tenantId: string,
  input: ListTenantAuditEventsInput = {},
) {
  const { withTenantContext } = await import("@/lib/tenant/context");
  return withTenantContext(db, tenantId, (tx) =>
    listTenantAuditEventsInTx(tx, tenantId, input),
  );
}

export function parseAuditEventsQuery(searchParams: URLSearchParams) {
  const entityType = searchParams.get("entityType")?.trim() || undefined;
  const entityPublicId =
    searchParams.get("entityPublicId")?.trim() || undefined;
  const action = searchParams.get("action")?.trim() || undefined;
  const actorSubject = searchParams.get("actorSubject")?.trim() || undefined;
  const limitRaw = searchParams.get("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  const occurredAfterRaw = searchParams.get("occurredAfter")?.trim();
  const occurredBeforeRaw = searchParams.get("occurredBefore")?.trim();
  const cursorOccurredAtRaw = searchParams.get("cursorOccurredAt")?.trim();
  const cursorId = searchParams.get("cursorId")?.trim() || undefined;

  const occurredAfter = occurredAfterRaw
    ? new Date(occurredAfterRaw)
    : undefined;
  const occurredBefore = occurredBeforeRaw
    ? new Date(occurredBeforeRaw)
    : undefined;
  const cursorOccurredAt = cursorOccurredAtRaw
    ? new Date(cursorOccurredAtRaw)
    : undefined;

  if (occurredAfter && Number.isNaN(occurredAfter.getTime())) {
    throw new Error("occurredAfter must be a valid ISO timestamp.");
  }

  if (occurredBefore && Number.isNaN(occurredBefore.getTime())) {
    throw new Error("occurredBefore must be a valid ISO timestamp.");
  }

  if (cursorOccurredAt && Number.isNaN(cursorOccurredAt.getTime())) {
    throw new Error("cursorOccurredAt must be a valid ISO timestamp.");
  }

  if ((cursorOccurredAt && !cursorId) || (!cursorOccurredAt && cursorId)) {
    throw new Error("cursorOccurredAt and cursorId must be supplied together.");
  }

  return {
    entityType,
    entityPublicId,
    action,
    actorSubject,
    occurredAfter,
    occurredBefore,
    cursorOccurredAt,
    cursorId,
    limit,
  };
}
