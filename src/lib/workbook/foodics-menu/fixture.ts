import ExcelJS from "exceljs";

/* Test support only (QOS-216): writes a sanitized, portable workbook in the
   client's Foodics menu layout with exceljs, at the exact documented
   coordinates. Sheet names and header labels are ASSUMED (plan section 2.2).
   No client data, no demonstration content from the original and no
   credential column with values is ever written; nothing binary is
   committed. */

export const FIXTURE_SHEETS = {
  instructions: "Instructions",
  categories: "Categories",
  products: "Products",
  dashboard: "Dashboard",
  lists: "Lists",
  ingredients: "Ingredients",
  modifiers: "Modifiers",
  assignments: "Product Modifiers",
  prepared: "Prepared Items",
  users: "Users",
} as const;

export const FIXTURE_HEADERS = {
  categories: ["Name", "Name (AR)"],
  products: [
    "Product Name",
    "Product Name (AR)",
    "Description",
    "Description (AR)",
    "Category",
    "SKU",
    "Barcode",
    "Price",
    "Dine In Price",
    "Takeaway Price",
    "Delivery Price",
    "Pickup Price",
    "Tax %",
    "Cost",
    "Selling Method",
    "Active",
    "Calories",
    "Preparation Time",
    "Image",
  ],
  ingredients: ["Name", "Name (AR)", "Storage Unit", "Recipe Unit", "Conversion Factor", "Cost", "Category"],
  productRecipeLines: ["Product", "Ingredient", "Quantity"],
  modifiers: [
    "Group",
    "Group (AR)",
    "Option",
    "Option (AR)",
    "Price",
    "Dine In Price",
    "Takeaway Price",
    "Delivery Price",
    "Cost",
    "Calories",
  ],
  modifierIngredientLines: ["Option", "Ingredient", "Quantity"],
  assignments: ["Product", "Modifier Group", "Min", "Max", "Required", "Free Options"],
  preparedRecipeLines: ["Prepared Item", "Ingredient", "Quantity"],
} as const;

type Value = ExcelJS.CellValue;

/** Writes values left to right from a cell, e.g. `writeRow(sheet, "D11", [...])`. Blank entries stay empty. */
export function writeRow(worksheet: ExcelJS.Worksheet, start: string, values: Value[]) {
  const anchor = worksheet.getCell(start);
  values.forEach((value, offset) => {
    if (value === "" || value === null || value === undefined) return;
    worksheet.getCell(Number(anchor.row), Number(anchor.col) + offset).value = value;
  });
}

function writeRows(worksheet: ExcelJS.Worksheet, column: string, firstRow: number, rows: Value[][]) {
  rows.forEach((values, index) => writeRow(worksheet, `${column}${firstRow + index}`, values));
}

function exampleRows(count: number, width: number, label: string) {
  return Array.from({ length: count }, (_, index) =>
    Array.from({ length: width }, (_, column) => (column === 0 ? `${label} ${index + 1}` : column === 1 ? "مثال" : "")),
  );
}

/** Sanitized records covering every business area. */
export const FILLED_RECORDS = {
  categories: [
    ["Hot drinks", "مشروبات ساخنة"],
    ["", "مشروبات خاصة"],
  ],
  products: [
    [
      "Flat White",
      "فلات وايت",
      "Double shot with steamed milk",
      "جرعتان مع حليب مبخر",
      "Hot drinks",
      "000123",
      "0062911234567",
      "12.50",
      "13.00",
      "12.50",
      "14.00",
      "",
      "5%",
      "4.20",
      "Unit",
      "Yes",
      "320",
      "5",
      "https://images.example.test/flat-white.jpg",
    ],
    [
      "Vanilla Latte",
      "فانيلا لاتيه",
      "",
      "",
      "Hot drinks",
      "000124",
      "0062911234574",
      "18",
      "18.00",
      "18.00",
      "19.50",
      "",
      "5%",
      "",
      "Unit",
      "Yes",
      "",
      "",
      "",
    ],
    ["", "كرك", "", "شاي بالحليب والهيل", "مشروبات خاصة", "000125", "", "6.00", "", "", "7.00", "", "5%", "", "", "Yes", "", "", ""],
  ] as Value[][],
  ingredients: [
    ["Whole milk", "حليب كامل", "l", "ml", "1000", "6.50", "Dairy"],
    ["Sugar", "سكر", "kg", "g", "1000", "3.25", "Dry goods"],
    ["Vanilla syrup", "شراب الفانيلا", "l", "ml", "1000", "", "Prepared"],
  ] as Value[][],
  productRecipeLines: [
    ["Flat White", "Whole milk", "0.2"],
    ["Vanilla Latte", "Vanilla syrup", "0.03"],
  ] as Value[][],
  modifiers: [
    ["Extras", "إضافات", "Extra syrup", "شراب إضافي", "2.00", "2.00", "2.00", "2.50", "0.40", "40"],
    ["Extras", "إضافات", "Oat milk", "حليب الشوفان", "3", "3.00", "3.00", "3.50", "0.90", "60"],
  ] as Value[][],
  modifierIngredientLines: [["Extra syrup", "Vanilla syrup", "0.015"]] as Value[][],
  assignments: [
    ["Flat White", "Extras", "0", "2", "No", "0"],
    ["Vanilla Latte", "Extras", "0", "2", "No", "1"],
  ] as Value[][],
  preparedRecipeLines: [
    ["Vanilla syrup", "Sugar", "0.5"],
    ["Vanilla syrup", "Whole milk", "0.5"],
  ] as Value[][],
};

/** Last row of the documented G/H prefill in the original (4,262 formulas over G18:H2148). */
export const PREFILL_LAST_ROW = 2148;

export type FoodicsFixtureOptions = {
  /** Sanitized business records in every area. Without it the workbook is untouched: examples and formulas only. */
  filled?: boolean;
  /** Text placed in every ignored sheet, to prove nothing from them leaks into a result. */
  sentinel?: string;
  /** Last row of the G/H formula prefill on the Ingredients sheet. */
  prefillLastRow?: number;
  /** Changes applied after the layout is written. */
  edit?: (workbook: ExcelJS.Workbook) => void;
};

export function buildFoodicsMenuWorkbook(options: FoodicsFixtureOptions = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "QOS test fixture";
  const fixedDate = new Date("2026-11-21T00:00:00Z");
  workbook.created = fixedDate;
  workbook.modified = fixedDate;
  const sentinel = options.sentinel;
  const filled = options.filled ?? false;

  // Instructions first: the sheet the merged parser used to read as a flat file.
  const instructions = workbook.addWorksheet(FIXTURE_SHEETS.instructions);
  writeRow(instructions, "A1", ["column_1", "column", "row", "AR", "EN"]);
  for (let index = 1; index <= 100; index += 1) {
    writeRow(instructions, `A${index + 1}`, [index, `Step ${index}`, index + 1, `الخطوة ${index}`, `Instruction step ${index} for the menu sheets.`]);
  }
  if (sentinel) writeRow(instructions, "G3", [sentinel]);

  const categories = workbook.addWorksheet(FIXTURE_SHEETS.categories);
  writeRow(categories, "B2", ["Categories"]);
  writeRow(categories, "F4", [...FIXTURE_HEADERS.categories]);
  writeRows(categories, "F", 5, exampleRows(3, 2, "Example category"));
  if (filled) writeRows(categories, "F", 8, FILLED_RECORDS.categories);

  const products = workbook.addWorksheet(FIXTURE_SHEETS.products);
  writeRow(products, "B2", ["Products"]);
  writeRow(products, "D6", [...FIXTURE_HEADERS.products]);
  writeRows(products, "D", 7, exampleRows(4, 19, "Example product"));
  if (filled) writeRows(products, "D", 11, FILLED_RECORDS.products);
  // Formatting and validation extents run past row 1000 and carry no value.
  for (let row = 11; row <= 1500; row += 1) {
    products.getCell(`I${row}`).numFmt = "@";
    products.getCell(`J${row}`).numFmt = "@";
  }
  for (let row = 11; row <= 1500; row += 50) {
    products.getCell(`H${row}`).dataValidation = { type: "list", allowBlank: true, formulae: ["Lists!$A$2:$A$20"] };
  }

  const dashboard = workbook.addWorksheet(FIXTURE_SHEETS.dashboard);
  writeRow(dashboard, "A1", ["Check", "Count"]);
  writeRow(dashboard, "A2", ["Products entered", { formula: "COUNTA(Products!D11:D1000)" }]);
  writeRow(dashboard, "A3", ["Categories entered", { formula: "COUNTA(Categories!F8:F1000)" }]);
  writeRow(dashboard, "A4", ["Ingredients entered", { formula: "COUNTA(Ingredients!D18:D1000)" }]);
  if (sentinel) writeRow(dashboard, "D2", [sentinel]);

  const lists = workbook.addWorksheet(FIXTURE_SHEETS.lists);
  writeRow(lists, "A1", ["Categories", "Yes/No", "Units"]);
  writeRows(lists, "A", 2, [
    ["Hot drinks", "Yes", "kg"],
    ["Cold drinks", "No", "l"],
  ]);
  if (sentinel) writeRow(lists, "E5", [sentinel]);

  const ingredients = workbook.addWorksheet(FIXTURE_SHEETS.ingredients);
  writeRow(ingredients, "B2", ["Ingredients"]);
  writeRow(ingredients, "D7", [...FIXTURE_HEADERS.ingredients]);
  writeRows(ingredients, "D", 8, exampleRows(10, 7, "Example ingredient"));
  writeRow(ingredients, "L7", [...FIXTURE_HEADERS.productRecipeLines]);
  writeRows(ingredients, "L", 8, exampleRows(7, 3, "Example recipe line"));
  // The conversion/unit prefill: formulas with no cached result, as in the original.
  const prefillLastRow = options.prefillLastRow ?? PREFILL_LAST_ROW;
  for (let row = 18; row <= prefillLastRow; row += 1) {
    ingredients.getCell(`G${row}`).value = { formula: `IF(D${row}="","",F${row})` } as ExcelJS.CellFormulaValue;
    ingredients.getCell(`H${row}`).value = { formula: `IF(D${row}="","",1)` } as ExcelJS.CellFormulaValue;
  }
  if (filled) {
    writeRows(ingredients, "D", 18, FILLED_RECORDS.ingredients);
    writeRows(ingredients, "L", 15, FILLED_RECORDS.productRecipeLines);
  }

  const modifiers = workbook.addWorksheet(FIXTURE_SHEETS.modifiers);
  writeRow(modifiers, "B2", ["Modifiers"]);
  writeRow(modifiers, "F8", [...FIXTURE_HEADERS.modifiers]);
  writeRows(modifiers, "F", 9, exampleRows(4, 10, "Example modifier"));
  writeRow(modifiers, "R8", [...FIXTURE_HEADERS.modifierIngredientLines]);
  writeRows(modifiers, "R", 9, exampleRows(4, 3, "Example option line"));
  if (filled) {
    writeRows(modifiers, "F", 13, FILLED_RECORDS.modifiers);
    writeRows(modifiers, "R", 13, FILLED_RECORDS.modifierIngredientLines);
  }

  const assignments = workbook.addWorksheet(FIXTURE_SHEETS.assignments);
  writeRow(assignments, "B2", ["Product modifiers"]);
  writeRow(assignments, "D6", [...FIXTURE_HEADERS.assignments]);
  writeRows(assignments, "D", 7, exampleRows(2, 6, "Example assignment"));
  if (filled) writeRows(assignments, "D", 9, FILLED_RECORDS.assignments);

  const prepared = workbook.addWorksheet(FIXTURE_SHEETS.prepared);
  writeRow(prepared, "B2", ["Prepared items"]);
  writeRow(prepared, "I6", [...FIXTURE_HEADERS.preparedRecipeLines]);
  writeRows(prepared, "I", 7, exampleRows(3, 3, "Example prepared line"));
  if (filled) writeRows(prepared, "I", 10, FILLED_RECORDS.preparedRecipeLines);

  // An account sheet: headers only, never any value (and never a credential word).
  const users = workbook.addWorksheet(FIXTURE_SHEETS.users, { state: "hidden" });
  writeRow(users, "A1", ["Name", "Email", "Role"]);
  if (sentinel) writeRow(users, "A2", [sentinel]);

  options.edit?.(workbook);
  return workbook;
}

export async function buildFoodicsMenuFixture(options: FoodicsFixtureOptions = {}) {
  return Buffer.from(await buildFoodicsMenuWorkbook(options).xlsx.writeBuffer());
}

export const FOODICS_FIXTURE_FILE_NAME = "sanitized-foodics-menu.xlsx";
