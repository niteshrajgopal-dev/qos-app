import { describe, expect, it } from "vitest";

import { columnExpectedInVersion, contractSheet, SUPPORTED_TEMPLATE_VERSIONS, WORKBOOK_CONTRACT } from "@/lib/workbook/contract";
import { parseWorkbookUpload, type ExtendedWorkbookParseResult } from "@/lib/workbook/reader";
import {
  parseModifierOptionNutrition,
  parseProductSellingAttributes,
  parseVariantSellingBasis,
  SELLING_ATTRIBUTE_CAPABILITIES,
  sellingAttributeCapability,
  sellingAttributeOperationalCapabilities,
} from "@/lib/workbook/selling-attributes-capabilities";
import { writeTestZip } from "@/lib/workbook/test-support";

const QOS_214_COLUMNS = {
  Products: ["preparation_time_minutes", "walking_time_minutes", "high_salt", "is_stock_product"],
  Variants: ["selling_quantity_basis", "price_unit", "price_unit_quantity"],
  "Modifier Options": ["nutrition_calories"],
} as const;

/** Minimal OOXML: the manifest and a Products table with exactly `headers`. */
function productsOnlyWorkbook(version: string, headers: string[], row: Record<string, string> = {}) {
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const rel = (id: string, type: string, target: string) =>
    `<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}" Id="${id}"/>`;
  const rels = (body: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
  const letter = (index: number) =>
    index < 26 ? String.fromCharCode(65 + index) : `A${String.fromCharCode(65 + index - 26)}`;
  const str = (ref: string, value: string) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const context = WORKBOOK_CONTRACT.context.map((entry) =>
    entry.field === "template_version" ? { ...entry, value: version } : entry,
  );
  const contextRows = context
    .map((entry, index) => `<row r="${2 + index}">${str(`A${2 + index}`, entry.field)}${entry.value ? str(`B${2 + index}`, entry.value) : ""}</row>`)
    .join("");
  const headerCells = headers.map((key, index) => str(`${letter(index)}6`, key)).join("");
  const dataCells = headers
    .map((key, index) => (row[key] ? str(`${letter(index)}7`, row[key]) : ""))
    .join("");
  const table = (id: number, name: string, ref: string, columns: string[]) =>
    `<?xml version="1.0" encoding="UTF-8"?><table ${ns} id="${id}" name="${name}" displayName="${name}" ref="${ref}"><tableColumns count="${columns.length}">${columns.map((column, index) => `<tableColumn id="${index + 1}" name="${column}"/>`).join("")}</tableColumns></table>`;

  return writeTestZip([
    { name: "[Content_Types].xml", data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: "_rels/.rels", data: rels(rel("R1", "officeDocument", "xl/workbook.xml")) },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0"?><workbook ${ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Start Here" sheetId="1" r:id="Ra"/><sheet name="Products" sheetId="2" r:id="Rb"/></sheets></workbook>`,
    },
    { name: "xl/_rels/workbook.xml.rels", data: rels(rel("Ra", "worksheet", "worksheets/sheet1.xml") + rel("Rb", "worksheet", "worksheets/sheet2.xml")) },
    {
      name: "xl/worksheets/sheet1.xml",
      data: `<?xml version="1.0"?><worksheet ${ns}><sheetData><row r="1">${str("A1", "field")}${str("B1", "value")}${str("C1", "rule")}</row>${contextRows}</sheetData></worksheet>`,
    },
    { name: "xl/worksheets/_rels/sheet1.xml.rels", data: rels(rel("Rt1", "table", "../tables/table1.xml")) },
    { name: "xl/tables/table1.xml", data: table(1, "QOS_Workbook_Context", `A1:C${1 + context.length}`, ["field", "value", "rule"]) },
    {
      name: "xl/worksheets/sheet2.xml",
      data: `<?xml version="1.0"?><worksheet ${ns}><sheetData><row r="6">${headerCells}</row><row r="7">${dataCells}</row></sheetData></worksheet>`,
    },
    { name: "xl/worksheets/_rels/sheet2.xml.rels", data: rels(rel("Rt2", "table", "../tables/table2.xml")) },
    { name: "xl/tables/table2.xml", data: table(2, "QOS_Products", `A6:${letter(headers.length - 1)}8`, headers) },
  ]);
}

async function productsSheet(bytes: Buffer) {
  const result = (await parseWorkbookUpload({ fileName: "products.xlsx", bytes })) as ExtendedWorkbookParseResult;
  expect(result.profile).toBe("qos_extended_v1");
  return { result, products: result.sheets.find((entry) => entry.sheet === "Products")! };
}

describe("workbook contract 1.3", () => {
  it("is version 1.5 and still marks exactly the QOS-214 columns as since 1.3, in the agreed positions", () => {
    expect(WORKBOOK_CONTRACT.version).toBe("1.5");
    for (const [sheetName, keys] of Object.entries(QOS_214_COLUMNS)) {
      const columns = contractSheet(sheetName).columns;
      expect(columns.filter((column) => column.sinceVersion === "1.3").map((column) => column.key)).toEqual(keys);
    }
    const order = (sheetName: string) => contractSheet(sheetName).columns.map((column) => column.key);
    expect(order("Products").slice(order("Products").indexOf("nutrition_calories"), order("Products").indexOf("image_url") + 1)).toEqual([
      "nutrition_calories",
      ...QOS_214_COLUMNS.Products,
      "image_url",
    ]);
    expect(order("Variants").slice(order("Variants").indexOf("currency"), order("Variants").indexOf("status") + 1)).toEqual([
      "currency",
      ...QOS_214_COLUMNS.Variants,
      "status",
    ]);
    const options = order("Modifier Options");
    expect(options.slice(options.indexOf("currency"), options.indexOf("is_default") + 1)).toEqual([
      "currency",
      "nutrition_calories",
      "is_default",
    ]);
  });

  it("accepts 1.0 to 1.5 and the numeric 1, ordered 1.0 < 1.1 < 1.2 < 1.3 < 1.4 < 1.5", () => {
    expect(SUPPORTED_TEMPLATE_VERSIONS).toEqual(["1.0", "1.1", "1.2", "1.3", "1.4", "1.5"]);
    const column = contractSheet("Products").columns.find((entry) => entry.key === "high_salt")!;
    expect(["1", "1.0", "1.1", "1.2", "1.3", "1.4"].map((version) => columnExpectedInVersion(column, version))).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
    const existing = contractSheet("Products").columns.find((entry) => entry.key === "barcode")!;
    expect(columnExpectedInVersion(existing, "1.0")).toBe(true);
  });

  it("does not warn about missing 1.3 columns in a 1.0 file, but does in a 1.3 file", async () => {
    const v10Headers = contractSheet("Products").columns.filter((column) => !column.sinceVersion).map((column) => column.key);
    for (const version of ["1.0", "1"]) {
      const { result, products } = await productsSheet(productsOnlyWorkbook(version, v10Headers));
      expect(result.templateVersion).toBe("1.0");
      expect(products.issues.filter((issue) => issue.code === "missing_columns")).toEqual([]);
    }

    const { result, products } = await productsSheet(productsOnlyWorkbook("1.3", v10Headers));
    expect(result.templateVersion).toBe("1.3");
    expect(products.issues).toContainEqual({
      sheet: "Products",
      severity: "warning",
      code: "missing_columns",
      params: { columns: QOS_214_COLUMNS.Products.join(", ") },
    });
  });

  it("reads 1.3 values as typed text without coercing barcodes or blanks", async () => {
    const headers = contractSheet("Products").columns.map((column) => column.key);
    const { products } = await productsSheet(
      productsOnlyWorkbook("1.3", headers, {
        product_key: "flat-white",
        action: "create",
        internal_name: "flat-white",
        barcode: "001234",
        preparation_time_minutes: "0",
        high_salt: "FALSE",
        is_stock_product: "TRUE",
      }),
    );
    const values = products.rows[0]!.values;
    expect(values).toMatchObject({
      barcode: "001234",
      preparation_time_minutes: "0",
      walking_time_minutes: "",
      high_salt: "FALSE",
      is_stock_product: "TRUE",
    });
    expect(parseProductSellingAttributes(values).fields).toEqual({
      preparationTimeMinutes: 0,
      walkingTimeMinutes: null,
      highSalt: false,
      directStockIntent: true,
    });
  });
});

describe("selling attribute capabilities", () => {
  it("declares stored fields persistable, unresolved mappings review_only and operations deferred", () => {
    const byClass = (classification: string) =>
      SELLING_ATTRIBUTE_CAPABILITIES.filter((capability) => capability.classification === classification).map(
        (capability) => capability.key,
      );
    expect(byClass("persistable")).toEqual([
      "product.preparation_time_minutes",
      "product.walking_time_minutes",
      "product.high_salt",
      "product.is_stock_product",
      "variant.selling_quantity_basis",
      "variant.price_unit",
      "variant.price_unit_quantity",
      "modifier_option.nutrition_calories",
    ]);
    expect(byClass("review_only")).toEqual(["variant.weight_basis_unresolved", "product.direct_stock_unresolved"]);
    expect(byClass("deferred")).toEqual([
      "operation.fractional_checkout",
      "operation.scale_integration",
      "operation.pos",
      "operation.stock_deduction",
      "operation.recipe_fabrication",
    ]);
    expect(SELLING_ATTRIBUTE_CAPABILITIES.some((capability) => (capability.classification as string) === "supported")).toBe(
      false,
    );
  });

  it("maps every persistable column to a contract column", () => {
    for (const capability of SELLING_ATTRIBUTE_CAPABILITIES.filter((entry) => entry.classification === "persistable")) {
      const column = contractSheet(capability.sheet!).columns.find((entry) => entry.key === capability.column);
      expect(column?.mapping, capability.key).toBe(capability.target);
    }
    expect(sellingAttributeCapability("product.is_stock_product")?.target).toBe("catalogue_products.direct_stock_intent");
  });

  it("flags stock-product intent as unresolved review only and never as eligible", () => {
    const parsed = parseProductSellingAttributes({ is_stock_product: "TRUE" });
    expect(parsed.diagnostics).toEqual([
      { severity: "warning", classification: "review_only", code: "direct_stock_unresolved", column: "is_stock_product" },
    ]);
    expect(parseProductSellingAttributes({ is_stock_product: "FALSE" }).diagnostics).toEqual([]);
    expect(parseProductSellingAttributes({}).diagnostics).toEqual([]);
    expect(
      sellingAttributeOperationalCapabilities({
        directStockIntent: true,
        sellingQuantityBasis: "weight",
        priceUnit: "kg",
        priceUnitQuantity: 1,
      }),
    ).toEqual({
      directStockConsumptionEligible: false,
      fractionalCheckout: false,
      directStockMapping: "unresolved",
      sellingBasis: "weight_resolved",
    });
  });

  it("keeps weight without unit and quantity unresolved, and rejects illegal pairs", () => {
    expect(parseVariantSellingBasis({ selling_quantity_basis: "weight" })).toEqual({
      fields: { sellingQuantityBasis: "weight", priceUnit: null, priceUnitQuantity: null },
      diagnostics: [
        { severity: "warning", classification: "review_only", code: "weight_basis_unresolved", column: "selling_quantity_basis" },
      ],
    });
    expect(
      parseVariantSellingBasis({ selling_quantity_basis: "weight", price_unit: "g", price_unit_quantity: "100" }).diagnostics,
    ).toEqual([]);
    expect(parseVariantSellingBasis({}).fields).toEqual({ sellingQuantityBasis: null, priceUnit: null, priceUnitQuantity: null });
    expect(parseVariantSellingBasis({}).diagnostics).toEqual([]);
    expect(parseVariantSellingBasis({ selling_quantity_basis: "weight", price_unit: "each" }).diagnostics[0]?.code).toBe(
      "illegal_basis_unit",
    );
    expect(parseVariantSellingBasis({ selling_quantity_basis: "each", price_unit: "kg" }).diagnostics[0]?.code).toBe(
      "illegal_basis_unit",
    );
    expect(parseVariantSellingBasis({ price_unit_quantity: "0" }).diagnostics[0]?.code).toBe("invalid_positive_number");
  });

  it("parses option calories and invalid values without guessing", () => {
    expect(parseModifierOptionNutrition({ nutrition_calories: "0" }).fields.nutritionCalories).toBe(0);
    expect(parseModifierOptionNutrition({ nutrition_calories: "" }).fields.nutritionCalories).toBeNull();
    expect(parseModifierOptionNutrition({ nutrition_calories: "12.5" }).diagnostics[0]?.code).toBe("invalid_integer");
    expect(parseProductSellingAttributes({ high_salt: "maybe" }).diagnostics[0]?.code).toBe("invalid_boolean");
  });
});
