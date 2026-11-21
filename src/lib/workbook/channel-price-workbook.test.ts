import { describe, expect, it } from "vitest";

import { contractSheet, isDeferredField, sheetSupport, SUPPORTED_ENTITY_SHEETS } from "@/lib/workbook/contract";
import {
  CHANNEL_PRICE_CAPABILITIES,
  CHANNEL_PRICE_DEFERRED_SCOPES,
  persistableChannelFields,
  type ChannelSheetName,
} from "@/lib/workbook/channel-price-capabilities";
import {
  buildWorkbookSlotMap,
  resolveWorkbookSlotChannel,
  validateChannelPriceRows,
  validateSalesChannelRows,
  type KnownChannel,
} from "@/lib/workbook/channel-price-rows";
import { parseWorkbookUpload, type ExtendedWorkbookParseResult, type WorkbookRow } from "@/lib/workbook/reader";
import { buildBlankWorkbookTemplate } from "@/lib/workbook/template";
import { fillSheet, loadWorkbook, saveWorkbook, setManifestValue } from "@/lib/workbook/test-support";

const CHANNEL_SHEETS: ChannelSheetName[] = ["Sales Channels", "Variant Channel Prices", "Modifier Option Channel Prices"];

let blank: Promise<Buffer> | null = null;
function template() {
  blank ??= buildBlankWorkbookTemplate();
  return blank;
}

async function parse(bytes: Buffer) {
  const result = await parseWorkbookUpload({ fileName: "qos.xlsx", bytes });
  if (result.profile !== "qos_extended_v1") throw new Error("expected the expanded profile");
  return result as ExtendedWorkbookParseResult;
}

function rows(entries: Array<Record<string, string>>, first = 7): WorkbookRow[] {
  return entries.map((values, index) => ({ row: first + index, values }));
}

const CONFIGURED: KnownChannel[] = [
  { publicId: "schan_aggregator-1_aaaa1111", code: "aggregator_1", workbookSlot: "aggregator_1", status: "active" },
  { publicId: "schan_aggregator-2_bbbb2222", code: "aggregator_2", workbookSlot: "aggregator_2", status: "active" },
];

describe("1.2 channel sheets in the template", () => {
  it("are supported entity sheets with slot and action dropdowns", async () => {
    for (const sheet of CHANNEL_SHEETS) {
      expect(sheetSupport(sheet)).toBe("supported");
      expect(SUPPORTED_ENTITY_SHEETS).toContain(sheet);
    }
    const workbook = await loadWorkbook(await template());
    expect(workbook.getWorksheet("Sales Channels")!.getCell("E7").dataValidation).toMatchObject({
      type: "list",
      formulae: ['"aggregator_1,aggregator_2,aggregator_3"'],
    });
    expect(workbook.getWorksheet("Variant Channel Prices")!.getCell("F7").dataValidation).toMatchObject({
      formulae: ['"set,reset_to_central"'],
    });
    expect(workbook.getWorksheet("Variant Channel Prices")!.getRow(6).values).toEqual([
      undefined,
      "qos_variant_id",
      "qos_channel_id",
      "workbook_slot",
      "amount_minor",
      "currency",
      "action",
      "expected_revision",
      "row_check",
    ]);
  });
});

describe("template version compatibility", () => {
  async function olderFile(version: string) {
    const workbook = await loadWorkbook(await template());
    setManifestValue(workbook, "template_version", version);
    for (const name of CHANNEL_SHEETS) {
      workbook.removeWorksheet(workbook.getWorksheet(name)!.id);
    }
    fillSheet(workbook, "Branch Prices", 6, [
      { branch_price_key: "bp1", action: "create", variant_key: "var_a", branch_key: "loc_a", amount_minor: "2400", currency: "AED" },
    ]);
    return saveWorkbook(workbook);
  }

  it.each(["1.0", "1.1", 1])("reads a %s file without the channel sheets and without any missing-sheet note", async (version) => {
    const result = await parse(await olderFile(String(version)));
    expect(result.templateVersion).toBe(version === 1 ? "1.0" : String(version));
    for (const name of CHANNEL_SHEETS) {
      const sheet = result.sheets.find((entry) => entry.sheet === name)!;
      expect(sheet).toMatchObject({ present: false, rowCount: 0, issues: [] });
    }
    expect(result.issues).toEqual([]);
    expect(result.summary).toMatchObject({ errors: 0, warnings: 0 });
    expect(result.sheets.find((entry) => entry.sheet === "Branch Prices")!.rows[0]!.values.amount_minor).toBe("2400");
  });

  it("still notes the channel sheets as missing in a 1.2 file", async () => {
    const workbook = await loadWorkbook(await template());
    workbook.removeWorksheet(workbook.getWorksheet("Sales Channels")!.id);
    const result = await parse(await saveWorkbook(workbook));
    expect(result.sheets.find((entry) => entry.sheet === "Sales Channels")!.issues).toEqual([
      { sheet: "Sales Channels", severity: "info", code: "sheet_missing", params: { table: "QOS_Sales_Channels" } },
    ]);
  });

  it("reads typed zero as text 0 and leaves a blank amount blank", async () => {
    const workbook = await loadWorkbook(await template());
    fillSheet(workbook, "Variant Channel Prices", 6, [
      { qos_variant_id: "var_a", workbook_slot: "aggregator_1", amount_minor: 0, currency: "AED", action: "set" },
      { qos_variant_id: "var_a", workbook_slot: "aggregator_2", currency: "AED", action: "set" },
    ]);
    const result = await parse(await saveWorkbook(workbook));
    const sheet = result.sheets.find((entry) => entry.sheet === "Variant Channel Prices")!;
    expect(sheet.rows.map((row) => row.values.amount_minor)).toEqual(["0", ""]);
    expect(sheet.issues).toEqual([]);
  });
});

describe("validateChannelPriceRows", () => {
  const slotMap = buildWorkbookSlotMap(CONFIGURED);
  const subjects = new Map([
    ["var_a", { currency: "AED" }],
    ["var_b", { currency: "AED" }],
    ["var_c", { currency: "AED" }],
  ]);

  it("resolves Aggregator 1/2 through workbook_slot and flags an unmapped slot instead of guessing", () => {
    expect(resolveWorkbookSlotChannel("aggregator_1", slotMap)?.publicId).toBe("schan_aggregator-1_aaaa1111");
    expect(resolveWorkbookSlotChannel("aggregator_3", slotMap)).toBeNull();

    const result = validateChannelPriceRows(
      "Variant Channel Prices",
      rows([
        { qos_variant_id: "var_a", workbook_slot: "aggregator_1", amount_minor: "2100", currency: "AED", action: "set" },
        { qos_variant_id: "var_a", workbook_slot: "aggregator_3", amount_minor: "2300", currency: "AED", action: "set" },
      ]),
      { slotMap, subjects },
    );
    expect(result.intents).toEqual([
      {
        row: 7,
        subjectPublicId: "var_a",
        channel: { publicId: "schan_aggregator-1_aaaa1111", code: "aggregator_1", workbookSlot: "aggregator_1" },
        currency: "AED",
        expectedRevision: null,
        kind: "set",
        amountMinor: 2100,
      },
    ]);
    expect(result.findings).toEqual([
      {
        sheet: "Variant Channel Prices",
        row: 8,
        severity: "error",
        code: "unmapped_workbook_slot",
        column: "workbook_slot",
        params: { value: "aggregator_3" },
      },
    ]);
  });

  it("keeps zero, blank, keep and reset_to_central distinct", () => {
    const result = validateChannelPriceRows(
      "Variant Channel Prices",
      rows([
        { qos_variant_id: "var_a", workbook_slot: "aggregator_1", amount_minor: "0", action: "set" },
        { qos_variant_id: "var_a", workbook_slot: "aggregator_2", amount_minor: "", action: "set" },
        { qos_variant_id: "var_b", workbook_slot: "aggregator_1", amount_minor: "", action: "reset_to_central" },
        { qos_variant_id: "var_b", workbook_slot: "aggregator_2", amount_minor: "", action: "" },
        { qos_variant_id: "var_c", qos_channel_id: "schan_aggregator-2_bbbb2222", amount_minor: "0", action: "reset_to_central" },
      ]),
      { slotMap, subjects },
    );

    expect(result.intents.map((intent) => [intent.row, intent.kind, "amountMinor" in intent ? intent.amountMinor : null])).toEqual([
      [7, "set", 0],
      [9, "reset_to_central", null],
      [10, "keep", null],
    ]);
    expect(result.findings.map((finding) => [finding.row, finding.code, finding.severity, finding.reviewHint ?? false])).toEqual([
      [8, "blank_amount_for_set", "error", false],
      [10, "suggested_fallback_to_central", "info", true],
      [11, "amount_with_reset", "error", false],
    ]);
  });

  it("refuses another currency, a typed amount without an action, duplicates and unknown references", () => {
    const options = new Map(["opt_a", "opt_b", "opt_c", "opt_d", "opt_e"].map((id) => [id, { currency: "AED" }]));
    const result = validateChannelPriceRows(
      "Modifier Option Channel Prices",
      rows([
        { qos_modifier_option_id: "opt_a", workbook_slot: "aggregator_1", amount_minor: "300", currency: "USD", action: "set" },
        { qos_modifier_option_id: "opt_b", workbook_slot: "aggregator_2", amount_minor: "300", currency: "AED", action: "" },
        { qos_modifier_option_id: "opt_c", qos_channel_id: "schan_aggregator-2_bbbb2222", amount_minor: "350", action: "set" },
        { qos_modifier_option_id: "opt_c", workbook_slot: "aggregator_2", amount_minor: "360", action: "set" },
        { qos_modifier_option_id: "opt_zz", qos_channel_id: "schan_missing_00000000", amount_minor: "1", action: "set" },
        { qos_modifier_option_id: "opt_d", qos_channel_id: "schan_aggregator-1_aaaa1111", workbook_slot: "aggregator_2", amount_minor: "1", action: "set" },
        { qos_modifier_option_id: "opt_e", workbook_slot: "aggregator_1", amount_minor: "1.5", action: "set" },
        { qos_modifier_option_id: "opt_e", workbook_slot: "aggregator_2", amount_minor: "-1", action: "set" },
        { qos_modifier_option_id: "opt_e", qos_channel_id: "schan_aggregator-1_aaaa1111", amount_minor: "5", action: "replace" },
      ]),
      { slotMap, subjects: options },
    );

    expect(result.findings.map((finding) => [finding.row, finding.code])).toEqual([
      [7, "currency_mismatch"],
      [8, "amount_without_action"],
      [10, "duplicate_channel_price"],
      [11, "unknown_subject"],
      [11, "unknown_channel"],
      [11, "missing_currency"],
      [12, "channel_slot_mismatch"],
      [13, "invalid_amount"],
      [14, "invalid_amount"],
      [15, "unknown_action"],
      [15, "duplicate_channel_price"],
    ]);
    // The typed amount on row 8 has no action: it is reported and kept, never applied.
    expect(result.intents.map((intent) => [intent.row, intent.kind])).toEqual([
      [8, "keep"],
      [9, "set"],
    ]);
  });

  it("maps a slot to a channel created by a Sales Channels row in the same file", () => {
    const channels = validateSalesChannelRows(
      rows([{ channel_code: "aggregator_3", display_name: "Aggregator 3", kind: "aggregator", workbook_slot: "aggregator_3", status: "active" }]),
      CONFIGURED,
    );
    expect(channels.findings).toEqual([]);
    const map = buildWorkbookSlotMap(CONFIGURED, channels.intents);
    expect(resolveWorkbookSlotChannel("aggregator_3", map)).toEqual({ publicId: null, code: "aggregator_3", workbookSlot: "aggregator_3" });
  });
});

describe("validateSalesChannelRows", () => {
  it("flags a slot used twice, an archived slot, a renamed code and bad values", () => {
    const result = validateSalesChannelRows(
      rows([
        { qos_channel_id: "schan_aggregator-1_aaaa1111", channel_code: "aggregator_1", display_name: "Aggregator 1", kind: "aggregator", workbook_slot: "aggregator_1", status: "active" },
        { channel_code: "late_night", display_name: "Late night", kind: "aggregator", workbook_slot: "aggregator_1", status: "active" },
        { qos_channel_id: "schan_aggregator-2_bbbb2222", channel_code: "renamed", display_name: "Aggregator 2", kind: "aggregator", status: "active" },
        { channel_code: "Bad Code", display_name: "", kind: "branch", workbook_slot: "aggregator_9", status: "deleted" },
        { channel_code: "old", display_name: "Old", kind: "other", workbook_slot: "aggregator_2", status: "archived" },
      ]),
      CONFIGURED,
    );
    expect(result.findings.map((finding) => [finding.row, finding.code])).toEqual([
      [8, "duplicate_workbook_slot"],
      [9, "channel_code_immutable"],
      [10, "invalid_channel_code"],
      [10, "missing_display_name"],
      [10, "invalid_kind"],
      [10, "invalid_status"],
      [10, "invalid_workbook_slot"],
      [11, "archived_channel"],
    ]);
    expect(result.intents.map((intent) => [intent.row, intent.operation])).toEqual([[7, "update"]]);
  });
});

describe("channel price capability contract for QOS-200", () => {
  it("declares every column of the three sheets and none as deferred", () => {
    for (const sheet of CHANNEL_SHEETS) {
      const columns = contractSheet(sheet).columns;
      expect(Object.keys(CHANNEL_PRICE_CAPABILITIES[sheet].fields).sort(), sheet).toEqual(columns.map((column) => column.key).sort());
      expect(columns.filter(isDeferredField).map((column) => column.key), sheet).toEqual([]);
      expect(Object.values(CHANNEL_PRICE_CAPABILITIES[sheet].fields)).not.toContain("deferred");
    }
  });

  it("lists the channel identity and price fields as persistable", () => {
    expect(persistableChannelFields("Sales Channels")).toEqual(["channel_code", "display_name", "kind", "workbook_slot", "status"]);
    expect(persistableChannelFields("Variant Channel Prices")).toEqual(["qos_variant_id", "qos_channel_id", "amount_minor", "currency"]);
    expect(persistableChannelFields("Modifier Option Channel Prices")).toEqual([
      "qos_modifier_option_id",
      "qos_channel_id",
      "amount_minor",
      "currency",
    ]);
    expect(CHANNEL_PRICE_CAPABILITIES["Variant Channel Prices"].operations).toHaveProperty("reset_to_central");
    expect(CHANNEL_PRICE_DEFERRED_SCOPES.map((entry) => entry.scope)).toEqual(["branch_channel_intersection"]);
  });
});
