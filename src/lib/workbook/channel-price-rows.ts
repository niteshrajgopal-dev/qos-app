import type { WorkbookRow } from "@/lib/workbook/reader";

/* Typed validation of the QOS-213 sales-channel sheets (review input for
   QOS-194, apply input for QOS-200). It is pure: it reads parsed rows plus
   what QOS already knows and returns typed intents and findings. It never
   writes, never guesses a channel from a name and never invents a price.

   - Aggregator 1/2/3 resolve only through a channel's workbook_slot.
   - Numeric 0 is a `set` of zero. A blank amount is not zero.
   - `reset_to_central` removes the explicit price; blank action keeps it. */

export type ChannelRowFindingCode =
  | "missing_channel_code"
  | "invalid_channel_code"
  | "duplicate_channel_code"
  | "channel_code_immutable"
  | "missing_display_name"
  | "invalid_kind"
  | "invalid_status"
  | "invalid_workbook_slot"
  | "duplicate_workbook_slot"
  | "unknown_channel"
  | "missing_channel_reference"
  | "unmapped_workbook_slot"
  | "channel_slot_mismatch"
  | "archived_channel"
  | "missing_subject"
  | "unknown_subject"
  | "unknown_action"
  | "blank_amount_for_set"
  | "invalid_amount"
  | "amount_with_reset"
  | "amount_without_action"
  | "missing_currency"
  | "currency_mismatch"
  | "duplicate_channel_price"
  | "suggested_fallback_to_central";

export type ChannelRowFinding = {
  severity: "error" | "warning" | "info";
  code: ChannelRowFindingCode;
  sheet: string;
  row: number;
  column?: string;
  /**
   * Set on suggestions. A review hint is advice for the person reviewing; it
   * is never a stored value and never source data.
   */
  reviewHint?: true;
  params?: Record<string, string | number>;
};

export const CHANNEL_WORKBOOK_SLOTS = ["aggregator_1", "aggregator_2", "aggregator_3"] as const;
export type ChannelWorkbookSlot = (typeof CHANNEL_WORKBOOK_SLOTS)[number];

const KINDS = ["aggregator", "other"];
const STATUSES = ["active", "archived"];
const CODE_PATTERN = /^[a-z0-9_]+$/;
const AMOUNT_PATTERN = /^\d+$/;
const MAX_AMOUNT_MINOR = 2_147_483_647;

/** A channel QOS already has, as loaded for review. */
export type KnownChannel = {
  publicId: string;
  code: string;
  workbookSlot: string | null;
  status: "active" | "archived";
};

/** Who a price row can point at: an existing channel, or one created by a Sales Channels row. */
export type ChannelRef = {
  publicId: string | null;
  code: string;
  workbookSlot: ChannelWorkbookSlot | null;
};

export type SalesChannelRowIntent = {
  row: number;
  operation: "create" | "update";
  qosChannelId: string | null;
  code: string;
  displayName: string;
  kind: "aggregator" | "other";
  workbookSlot: ChannelWorkbookSlot | null;
  status: "active" | "archived";
  expectedRevision: string | null;
};

export type ChannelPriceRowIntent = {
  row: number;
  subjectPublicId: string;
  channel: ChannelRef;
  currency: string | null;
  expectedRevision: string | null;
} & (
  | { kind: "set"; amountMinor: number }
  | { kind: "reset_to_central" }
  | { kind: "keep" }
);

function isSlot(value: string): value is ChannelWorkbookSlot {
  return (CHANNEL_WORKBOOK_SLOTS as readonly string[]).includes(value);
}

export function validateSalesChannelRows(rows: WorkbookRow[], known: KnownChannel[]) {
  const sheet = "Sales Channels";
  const findings: ChannelRowFinding[] = [];
  const intents: SalesChannelRowIntent[] = [];
  const knownById = new Map(known.map((channel) => [channel.publicId, channel]));
  const codes = new Set<string>();
  const slots = new Map<string, number>();

  for (const { row, values } of rows) {
    const add = (finding: Omit<ChannelRowFinding, "sheet" | "row">) => findings.push({ sheet, row, ...finding });
    const before = findings.length;
    const qosChannelId = values.qos_channel_id?.trim() || null;
    const code = values.channel_code?.trim() ?? "";
    const displayName = values.display_name?.trim() ?? "";
    const kind = values.kind?.trim() ?? "";
    const slot = values.workbook_slot?.trim() ?? "";
    const status = values.status?.trim() ?? "";

    const existing = qosChannelId ? knownById.get(qosChannelId) : undefined;
    if (qosChannelId && !existing) {
      add({ severity: "error", code: "unknown_channel", column: "qos_channel_id", params: { value: qosChannelId } });
    }
    if (!code) {
      add({ severity: "error", code: "missing_channel_code", column: "channel_code" });
    } else if (!CODE_PATTERN.test(code) || code.length > 64) {
      add({ severity: "error", code: "invalid_channel_code", column: "channel_code", params: { value: code } });
    } else if (codes.has(code)) {
      add({ severity: "error", code: "duplicate_channel_code", column: "channel_code", params: { value: code } });
    } else if (existing && existing.code !== code) {
      add({ severity: "error", code: "channel_code_immutable", column: "channel_code", params: { value: code, current: existing.code } });
    }
    codes.add(code);
    if (!displayName) {
      add({ severity: "error", code: "missing_display_name", column: "display_name" });
    }
    if (!KINDS.includes(kind)) {
      add({ severity: "error", code: "invalid_kind", column: "kind", params: { value: kind } });
    }
    if (!STATUSES.includes(status)) {
      add({ severity: "error", code: "invalid_status", column: "status", params: { value: status } });
    }
    if (slot && !isSlot(slot)) {
      add({ severity: "error", code: "invalid_workbook_slot", column: "workbook_slot", params: { value: slot } });
    } else if (slot && status === "archived") {
      add({ severity: "error", code: "archived_channel", column: "workbook_slot", params: { value: slot } });
    } else if (slot) {
      const first = slots.get(slot);
      if (first !== undefined) {
        add({ severity: "error", code: "duplicate_workbook_slot", column: "workbook_slot", params: { value: slot, firstRow: first } });
      } else {
        slots.set(slot, row);
      }
    }

    if (findings.length === before) {
      intents.push({
        row,
        operation: existing ? "update" : "create",
        qosChannelId,
        code,
        displayName,
        kind: kind as "aggregator" | "other",
        workbookSlot: slot ? (slot as ChannelWorkbookSlot) : null,
        status: status as "active" | "archived",
        expectedRevision: values.expected_revision?.trim() || null,
      });
    }
  }

  return { intents, findings };
}

/**
 * The slot map a workbook is reviewed against: QOS's configured channels,
 * overlaid by valid Sales Channels rows in the same file. Only active
 * channels hold a slot. A slot claimed twice maps to nothing.
 */
export function buildWorkbookSlotMap(known: KnownChannel[], sheetIntents: SalesChannelRowIntent[] = []) {
  const channels = new Map<string, ChannelRef & { status: string }>();
  for (const channel of known) {
    channels.set(channel.code, {
      publicId: channel.publicId,
      code: channel.code,
      workbookSlot: channel.workbookSlot && isSlot(channel.workbookSlot) ? channel.workbookSlot : null,
      status: channel.status,
    });
  }
  for (const intent of sheetIntents) {
    channels.set(intent.code, {
      publicId: intent.qosChannelId ?? channels.get(intent.code)?.publicId ?? null,
      code: intent.code,
      workbookSlot: intent.workbookSlot,
      status: intent.status,
    });
  }

  const bySlot = new Map<ChannelWorkbookSlot, ChannelRef | null>();
  for (const channel of channels.values()) {
    if (channel.status !== "active" || !channel.workbookSlot) continue;
    const ref = { publicId: channel.publicId, code: channel.code, workbookSlot: channel.workbookSlot };
    bySlot.set(channel.workbookSlot, bySlot.has(channel.workbookSlot) ? null : ref);
  }
  const byPublicId = new Map(
    [...channels.values()]
      .filter((channel) => channel.publicId)
      .map((channel) => [channel.publicId!, channel]),
  );
  return { bySlot, byPublicId };
}

export type WorkbookSlotMap = ReturnType<typeof buildWorkbookSlotMap>;

/** Resolves Aggregator 1/2/3 to a channel through workbook_slot only. */
export function resolveWorkbookSlotChannel(slot: ChannelWorkbookSlot, map: WorkbookSlotMap): ChannelRef | null {
  return map.bySlot.get(slot) ?? null;
}

export type ChannelPriceSubject = { currency: string | null; status?: "active" | "archived" };

export function validateChannelPriceRows(
  sheet: "Variant Channel Prices" | "Modifier Option Channel Prices",
  rows: WorkbookRow[],
  context: {
    slotMap: WorkbookSlotMap;
    /** Variants or options by public id, when known; unknown ids are flagged. */
    subjects?: Map<string, ChannelPriceSubject>;
  },
) {
  const subjectColumn = sheet === "Variant Channel Prices" ? "qos_variant_id" : "qos_modifier_option_id";
  const findings: ChannelRowFinding[] = [];
  const intents: ChannelPriceRowIntent[] = [];
  const seen = new Map<string, number>();

  for (const { row, values } of rows) {
    const add = (finding: Omit<ChannelRowFinding, "sheet" | "row">) => findings.push({ sheet, row, ...finding });
    const before = findings.length;
    const subjectPublicId = values[subjectColumn]?.trim() ?? "";
    const qosChannelId = values.qos_channel_id?.trim() ?? "";
    const slot = values.workbook_slot?.trim() ?? "";
    const amountText = values.amount_minor?.trim() ?? "";
    const currencyText = values.currency?.trim().toUpperCase() ?? "";
    const action = values.action?.trim() ?? "";
    const expectedRevision = values.expected_revision?.trim() || null;

    // Subject.
    let subject: ChannelPriceSubject | undefined;
    if (!subjectPublicId) {
      add({ severity: "error", code: "missing_subject", column: subjectColumn });
    } else if (context.subjects) {
      subject = context.subjects.get(subjectPublicId);
      if (!subject) {
        add({ severity: "error", code: "unknown_subject", column: subjectColumn, params: { value: subjectPublicId } });
      }
    }

    // Channel: by QOS id, by workbook slot, or both (they must agree).
    let channel: ChannelRef | null = null;
    if (slot && !isSlot(slot)) {
      add({ severity: "error", code: "invalid_workbook_slot", column: "workbook_slot", params: { value: slot } });
    }
    const bySlot = slot && isSlot(slot) ? resolveWorkbookSlotChannel(slot, context.slotMap) : null;
    if (qosChannelId) {
      const known = context.slotMap.byPublicId.get(qosChannelId);
      if (!known) {
        add({ severity: "error", code: "unknown_channel", column: "qos_channel_id", params: { value: qosChannelId } });
      } else if (known.status !== "active") {
        add({ severity: "error", code: "archived_channel", column: "qos_channel_id", params: { value: qosChannelId } });
      } else {
        channel = { publicId: known.publicId, code: known.code, workbookSlot: known.workbookSlot };
        if (slot && isSlot(slot) && bySlot?.code !== known.code) {
          add({
            severity: "error",
            code: "channel_slot_mismatch",
            column: "workbook_slot",
            params: { value: slot, channel: qosChannelId },
          });
        }
      }
    } else if (slot && isSlot(slot)) {
      if (!bySlot) {
        // Never guessed: the price waits until a channel is given this slot.
        add({ severity: "error", code: "unmapped_workbook_slot", column: "workbook_slot", params: { value: slot } });
      } else {
        channel = bySlot;
      }
    } else if (!slot) {
      add({ severity: "error", code: "missing_channel_reference", column: "qos_channel_id" });
    }

    // Currency must match the subject's base currency.
    const subjectCurrency = subject?.currency?.trim().toUpperCase() || null;
    if (currencyText && subjectCurrency && currencyText !== subjectCurrency) {
      add({
        severity: "error",
        code: "currency_mismatch",
        column: "currency",
        params: { value: currencyText, expected: subjectCurrency },
      });
    }
    const currency = currencyText || subjectCurrency;

    // Action and amount: set, reset_to_central and keep never collapse.
    let intent: ChannelPriceRowIntent | null = null;
    const base = { row, subjectPublicId, channel: channel!, currency, expectedRevision };
    if (action === "set") {
      if (!amountText) {
        add({ severity: "error", code: "blank_amount_for_set", column: "amount_minor" });
      } else if (!AMOUNT_PATTERN.test(amountText) || Number(amountText) > MAX_AMOUNT_MINOR) {
        add({ severity: "error", code: "invalid_amount", column: "amount_minor", params: { value: amountText } });
      } else if (!currency) {
        add({ severity: "error", code: "missing_currency", column: "currency" });
      } else {
        intent = { ...base, kind: "set", amountMinor: Number(amountText) };
      }
    } else if (action === "reset_to_central") {
      if (amountText) {
        add({ severity: "error", code: "amount_with_reset", column: "amount_minor", params: { value: amountText } });
      } else {
        intent = { ...base, kind: "reset_to_central" };
      }
    } else if (action === "") {
      if (amountText && !expectedRevision) {
        // A typed price with no action is not applied; say so instead of dropping it quietly.
        add({ severity: "warning", code: "amount_without_action", column: "action", params: { value: amountText } });
      } else if (!amountText) {
        add({
          severity: "info",
          code: "suggested_fallback_to_central",
          column: "amount_minor",
          reviewHint: true,
        });
      }
      intent = { ...base, kind: "keep" };
    } else {
      add({ severity: "error", code: "unknown_action", column: "action", params: { value: action } });
    }

    const identity = channel ? `${subjectPublicId}|${channel.publicId ?? `code:${channel.code}`}|${currency ?? ""}` : null;
    if (identity && subjectPublicId) {
      const first = seen.get(identity);
      if (first !== undefined) {
        add({ severity: "error", code: "duplicate_channel_price", params: { firstRow: first } });
      } else {
        seen.set(identity, row);
      }
    }

    const blocking = findings.slice(before).some((finding) => finding.severity === "error");
    if (intent && channel && !blocking) {
      intents.push(intent);
    }
  }

  return { intents, findings };
}
