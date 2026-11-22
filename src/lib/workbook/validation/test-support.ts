import { contractSheet, sheetSupport, WORKBOOK_CONTRACT, type SupportedEntitySheet } from "@/lib/workbook/contract";
import { revisionToken } from "@/lib/workbook/export";
import type { ReviewInput } from "@/lib/workbook/validation/model";
import { buildReviewSnapshot, type SnapshotSource } from "@/lib/workbook/validation/snapshot";

/* Test support only (QOS-194): review inputs and snapshots built in memory,
   in the export's column vocabulary, so engine rules are tested without a
   database or a file. Nothing here is used by the running app. */

export const TENANT = "ten_quotes_dev";
export const BRAND = "brd_quotes";

type Row = Record<string, string>;

function fullRow(sheet: string, values: Row): Row {
  const row: Row = {};
  for (const column of contractSheet(sheet).columns) row[column.key] = values[column.key] ?? "";
  return row;
}

/** A QOS-profile review input: rows numbered from the contract's first data row (7). */
export function qosInput(sheets: Partial<Record<string, Row[]>>, overrides: Partial<ReviewInput> = {}): ReviewInput {
  return {
    profile: "qos_extended_v1",
    sourceProfile: null,
    fileName: "edited.xlsx",
    fileFingerprint: "f".repeat(64),
    templateVersion: "1.0",
    dictionaryVersion: null,
    tenantPublicId: TENANT,
    brandPublicId: BRAND,
    currency: "AED",
    sourceNamespace: `qos:${TENANT}`,
    keysVerified: true,
    isExport: true,
    parseIssues: [],
    ...overrides,
    sheets: WORKBOOK_CONTRACT.sheets.map((definition) => {
      const rows = sheets[definition.name] ?? [];
      return {
        sheet: definition.name,
        support: sheetSupport(definition.name),
        present: rows.length > 0,
        columns: definition.columns.map((column) => column.key),
        rows: rows.map((values, index) => ({ row: WORKBOOK_CONTRACT.layout.extendedFirstDataRow + index, values: fullRow(definition.name, values) })),
        issues: [],
      };
    }),
  };
}

/** The integration seed in export vocabulary: Flat White (one default variant at 1800), Hot drinks, Milk/Oat milk, Main menu, two branches. */
export function seedRecords(): Partial<Record<SupportedEntitySheet, Row[]>> {
  const rev = (entity: string, id: string, version = 1) => revisionToken(entity, id, [version]);
  return {
    Branches: [
      { branch_key: "loc_quotes_hbz", qos_location_id: "loc_quotes_hbz", action: "skip", name: "HBZ Stadium", timezone: "Asia/Dubai", slug: "hbz", status: "active", expected_revision: rev("location", "loc_quotes_hbz"), clear_fields: "" },
      { branch_key: "loc_quotes_hct", qos_location_id: "loc_quotes_hct", action: "skip", name: "HCT Academic City", timezone: "Asia/Dubai", slug: "hct", status: "active", expected_revision: rev("location", "loc_quotes_hct"), clear_fields: "" },
    ],
    Categories: [
      { category_key: "cat_hot", qos_category_id: "cat_hot", action: "skip", internal_name: "hot-drinks", display_name_en: "Hot drinks", display_name_ar: "مشروبات ساخنة", sort_order: "1", status: "active", expected_revision: rev("category", "cat_hot"), clear_fields: "" },
    ],
    Products: [
      {
        product_key: "prd_flat_white",
        qos_product_id: "prd_flat_white",
        action: "skip",
        internal_name: "flat-white",
        display_name_en: "Flat White",
        display_name_ar: "فلات وايت",
        description_en: "Double shot",
        description_ar: "جرعتان",
        sku: "000123",
        barcode: "0062911234567",
        nutrition_calories: "120",
        image_url: "",
        status: "active",
        expected_revision: rev("product", "prd_flat_white"),
        clear_fields: "",
      },
    ],
    "Product Categories": [
      { product_category_key: "prd_flat_white~cat_hot", qos_product_category_id: "00000000-0000-4000-8000-0000000000a1", action: "skip", product_key: "prd_flat_white", category_key: "cat_hot", sort_order: "2", expected_revision: rev("product_category", "a1"), clear_fields: "" },
    ],
    Variants: [
      {
        variant_key: "var_flat_white_regular",
        qos_variant_id: "var_flat_white_regular",
        action: "skip",
        product_key: "prd_flat_white",
        variant_label_en: "Regular",
        variant_label_ar: "عادي",
        is_default: "TRUE",
        sort_order: "0",
        sku: "000123-R",
        barcode: "",
        amount_minor: "1800",
        currency: "AED",
        status: "active",
        price_tax_basis: "",
        tax_rate_basis_points: "",
        expected_revision: rev("variant", "var_flat_white_regular"),
        clear_fields: "",
      },
    ],
    "Branch Prices": [
      { branch_price_key: "var_flat_white_regular~loc_quotes_hbz~AED", qos_branch_price_id: "00000000-0000-4000-8000-0000000000b1", action: "skip", variant_key: "var_flat_white_regular", branch_key: "loc_quotes_hbz", amount_minor: "1900", currency: "AED", central_price_version: "1", expected_revision: rev("branch_price", "b1"), clear_fields: "" },
    ],
    "Modifier Groups": [
      { modifier_group_key: "mg_milk", qos_modifier_group_id: "mg_milk", action: "skip", internal_name: "milk", display_name_en: "Milk", display_name_ar: "الحليب", min_selections: "0", max_selections: "1", status: "active", expected_revision: rev("modifier_group", "mg_milk"), clear_fields: "" },
    ],
    "Modifier Options": [
      { modifier_option_key: "opt_oat", qos_modifier_option_id: "opt_oat", action: "skip", modifier_group_key: "mg_milk", display_name_en: "Oat milk", display_name_ar: "حليب الشوفان", price_minor: "300", currency: "AED", is_default: "FALSE", allows_quantity: "FALSE", max_quantity: "1", sort_order: "1", status: "active", expected_revision: rev("modifier_option", "opt_oat"), clear_fields: "" },
    ],
    "Product Modifiers": [
      { product_modifier_key: "prd_flat_white~mg_milk", qos_product_modifier_id: "00000000-0000-4000-8000-0000000000c1", action: "skip", product_key: "prd_flat_white", modifier_group_key: "mg_milk", sort_order: "0", free_options_count: "", expected_revision: rev("product_modifier", "c1"), clear_fields: "" },
    ],
    Menus: [
      { menu_key: "menu_main", qos_menu_id: "menu_main", action: "skip", internal_name: "main", display_name_en: "Main menu", display_name_ar: "القائمة الرئيسية", description_en: "", description_ar: "", status: "draft", expected_revision: rev("menu", "menu_main"), clear_fields: "" },
    ],
    "Menu Branches": [
      { menu_branch_key: "menu_main~loc_quotes_hbz", qos_menu_branch_id: "00000000-0000-4000-8000-0000000000d1", action: "skip", menu_key: "menu_main", branch_key: "loc_quotes_hbz", expected_revision: rev("menu_branch", "d1"), clear_fields: "" },
    ],
    "Menu Sections": [
      { section_key: "sec_coffee", qos_section_id: "sec_coffee", action: "skip", menu_key: "menu_main", internal_name: "coffee", display_name_en: "Coffee", display_name_ar: "القهوة", sort_order: "0", archived: "FALSE", expected_revision: rev("menu_section", "sec_coffee"), clear_fields: "" },
    ],
    "Menu Items": [
      { menu_item_key: "sec_coffee~prd_flat_white", qos_menu_item_id: "00000000-0000-4000-8000-0000000000e1", action: "skip", section_key: "sec_coffee", product_key: "prd_flat_white", sort_order: "0", archived: "FALSE", expected_revision: rev("menu_item", "e1"), clear_fields: "" },
    ],
  };
}

export function snapshotFrom(overrides: Partial<SnapshotSource> = {}) {
  return buildReviewSnapshot({
    tenantPublicId: TENANT,
    brandPublicId: BRAND,
    currency: "AED",
    businessProfile: "hospitality",
    records: seedRecords(),
    permittedBranches: [
      { publicId: "loc_quotes_hbz", name: "HBZ Stadium" },
      { publicId: "loc_quotes_hct", name: "HCT Academic City" },
    ],
    allBranchPublicIds: ["loc_quotes_hbz", "loc_quotes_hct"],
    ...overrides,
  });
}

export function emptySnapshot(overrides: Partial<SnapshotSource> = {}) {
  return snapshotFrom({ records: {}, permittedBranches: [], allBranchPublicIds: [], ...overrides });
}

/** A copy of a seed row with changes, e.g. an export row turned into an update. */
export function seedRow(sheet: SupportedEntitySheet, index: number, changes: Row = {}) {
  return { ...seedRecords()[sheet]![index]!, ...changes };
}
