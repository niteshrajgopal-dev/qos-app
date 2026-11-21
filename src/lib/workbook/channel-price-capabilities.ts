import { contractSheet } from "@/lib/workbook/contract";

/* Capability contract for the QOS-213 sales-channel sheets, consumed by the
   workbook review (QOS-194) and apply (QOS-200) work. It says, per column,
   whether QOS can store the value (`persistable`), only uses it to find or
   check a record during review (`review_only`), or cannot handle it yet
   (`deferred`). Nothing here applies anything. Kept separate from any other
   ticket's capability file on purpose. */

export type ChannelFieldCapability = "persistable" | "review_only" | "deferred";

export type ChannelSheetName = "Sales Channels" | "Variant Channel Prices" | "Modifier Option Channel Prices";

export type ChannelSheetCapability = {
  sheet: ChannelSheetName;
  sinceVersion: "1.2";
  /** Table written by QOS-200 when the row is applied. */
  target: string;
  /** Domain service QOS-200 must call; it enforces role, tenant, currency and version rules. */
  service: string;
  fields: Record<string, ChannelFieldCapability>;
  /** Row operations and what each means. Blank `action` keeps the current value. */
  operations: Record<string, string>;
};

export const CHANNEL_PRICE_CAPABILITIES: Record<ChannelSheetName, ChannelSheetCapability> = {
  "Sales Channels": {
    sheet: "Sales Channels",
    sinceVersion: "1.2",
    target: "sales_channels",
    service: "src/lib/catalogue/sales-channels.ts (createSalesChannel, updateSalesChannel)",
    fields: {
      qos_channel_id: "review_only",
      channel_code: "persistable",
      display_name: "persistable",
      kind: "persistable",
      workbook_slot: "persistable",
      status: "persistable",
      expected_revision: "review_only",
    },
    operations: {
      create: "Row without qos_channel_id: a new channel with this code.",
      update: "Row with qos_channel_id: display name, kind, workbook slot or status change. The code never changes.",
      archive: "status=archived: the channel keeps its prices and gives up its workbook slot. Channels are never deleted.",
    },
  },
  "Variant Channel Prices": {
    sheet: "Variant Channel Prices",
    sinceVersion: "1.2",
    target: "catalogue_variant_channel_prices",
    service: "src/lib/catalogue/channel-prices.ts (setVariantChannelPrice, resetVariantChannelPrice)",
    fields: {
      qos_variant_id: "persistable",
      qos_channel_id: "persistable",
      workbook_slot: "review_only",
      amount_minor: "persistable",
      currency: "persistable",
      action: "review_only",
      expected_revision: "review_only",
    },
    operations: {
      set: "Write amount_minor as the explicit channel price. 0 is a real price.",
      reset_to_central: "Remove the channel price; the channel inherits the central variant price.",
      keep: "Blank action: nothing is written for this row.",
    },
  },
  "Modifier Option Channel Prices": {
    sheet: "Modifier Option Channel Prices",
    sinceVersion: "1.2",
    target: "catalogue_modifier_option_channel_prices",
    service: "src/lib/catalogue/channel-prices.ts (setModifierOptionChannelPrice, resetModifierOptionChannelPrice)",
    fields: {
      qos_modifier_option_id: "persistable",
      qos_channel_id: "persistable",
      workbook_slot: "review_only",
      amount_minor: "persistable",
      currency: "persistable",
      action: "review_only",
      expected_revision: "review_only",
    },
    operations: {
      set: "Write amount_minor as the explicit channel price. 0 is a real price.",
      reset_to_central: "Remove the channel price; the channel inherits the option price.",
      keep: "Blank action: nothing is written for this row.",
    },
  },
};

/** Scopes QOS-200 must refuse rather than invent a rule for. */
export const CHANNEL_PRICE_DEFERRED_SCOPES = [
  {
    scope: "branch_channel_intersection",
    capability: "deferred" as const,
    reason:
      "A price for one branch and one channel together has no resolution rule. resolveBranchAndChannelPrice returns unsupported.",
  },
];

export function channelFieldCapability(sheet: ChannelSheetName, column: string): ChannelFieldCapability | null {
  return CHANNEL_PRICE_CAPABILITIES[sheet].fields[column] ?? null;
}

/** Columns of a channel sheet that QOS-200 may write. */
export function persistableChannelFields(sheet: ChannelSheetName) {
  return contractSheet(sheet)
    .columns.map((column) => column.key)
    .filter((key) => channelFieldCapability(sheet, key) === "persistable");
}
