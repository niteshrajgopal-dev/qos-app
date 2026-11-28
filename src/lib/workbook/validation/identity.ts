import { looseIdentity } from "@/lib/workbook/foodics-menu/keys";
import type { ReviewCandidate, ReviewLabel } from "@/lib/workbook/validation/model";
import type { ReviewSnapshot } from "@/lib/workbook/validation/snapshot";

/* Identity and matching (QOS-194, decision D-MATCH). A target is verified only
   by a QOS id (or an export key in the QOS namespace), a product source link
   for the review namespace, or a stored operator decision. Names are used for
   one thing: to find candidates for a Conflicting row. No code path here
   turns a name match into a target. */

type Row = Record<string, string>;

/** Sheets whose records have their own public id (the others are links between them). */
export const ENTITY_SHEETS = new Set([
  "Branches",
  "Categories",
  "Products",
  "Variants",
  "Modifier Groups",
  "Modifier Options",
  "Menus",
  "Menu Sections",
  // QOS-200 Phase 2 records: each has its own public id.
  "Units",
  "Suppliers",
  "Warehouses",
  "Inventory Categories",
  "Ingredients",
  "Recipes",
  "Recipe Lines",
  "Prep Steps",
  "Modifier Effects",
]);

/** Parent reference of a scoped entity: variants per product, options per group, sections per menu. */
export const PARENT_COLUMN: Record<string, string | undefined> = {
  Variants: "product_key",
  "Modifier Options": "modifier_group_key",
  "Menu Sections": "menu_key",
  // QOS-200: a warehouse belongs to its branch; lines, steps and effects to their recipe version.
  Warehouses: "branch_key",
  "Recipe Lines": "recipe_version_key",
  "Prep Steps": "recipe_version_key",
  "Modifier Effects": "recipe_version_key",
};

/** Name columns compared for collisions, per sheet. Same field against same field. */
export const NAME_COLUMNS: Record<string, string[]> = {
  Categories: ["display_name_en", "display_name_ar", "internal_name"],
  Products: ["display_name_en", "display_name_ar", "internal_name"],
  Variants: ["variant_label_en", "variant_label_ar"],
  "Modifier Groups": ["display_name_en", "display_name_ar", "internal_name"],
  "Modifier Options": ["display_name_en", "display_name_ar"],
  Menus: ["display_name_en", "display_name_ar", "internal_name"],
  "Menu Sections": ["display_name_en", "display_name_ar", "internal_name"],
  // QOS-200: candidates only. Lines, steps and effects are identified by key, parent and endpoints, never by name.
  Units: ["name", "name_ar", "code"],
  Suppliers: ["name"],
  Warehouses: ["name"],
  "Inventory Categories": ["name_en", "name_ar"],
  Ingredients: ["name_en", "name_ar"],
  Recipes: ["name"],
};

/** Loose names of a row, per name column, skipping blanks. */
export function looseNames(sheet: string, values: Row) {
  const names = new Map<string, string>();
  for (const column of NAME_COLUMNS[sheet] ?? []) {
    const loose = looseIdentity(values[column] ?? "");
    if (loose) names.set(column, loose);
  }
  return names;
}

export function namesCollide(sheet: string, left: Row, right: Row) {
  const a = looseNames(sheet, left);
  const b = looseNames(sheet, right);
  for (const [column, loose] of a) {
    if (b.get(column) === loose) return true;
  }
  return false;
}

/** Existing records of a sheet within one scope (all, or one parent public id). */
export function recordsInScope(snapshot: ReviewSnapshot, sheet: string, parentPublicId: string | null) {
  const records = snapshot.records[sheet as keyof ReviewSnapshot["records"]];
  if (!records) return [];
  const parent = PARENT_COLUMN[sheet];
  return [...records.entries()].filter(([, row]) => !parent || (parentPublicId !== null && row[parent] === parentPublicId));
}

export function variantsOfProduct(snapshot: ReviewSnapshot, productPublicId: string) {
  return recordsInScope(snapshot, "Variants", productPublicId);
}

function firstNonBlank(...values: Array<string | undefined>) {
  return values.find((value) => value && value.trim())?.trim() ?? "";
}

/** Readable name of a row or record, in each language, falling back to the other language and then the internal name. */
export function labelOf(sheet: string, values: Row | null | undefined): ReviewLabel {
  if (!values) return { en: "", ar: "" };
  if (sheet === "Branches") {
    return { en: values.name ?? "", ar: values.name ?? "" };
  }
  if (sheet === "Units") {
    return { en: firstNonBlank(values.name, values.name_ar, values.code), ar: firstNonBlank(values.name_ar, values.name, values.code) };
  }
  if (sheet === "Suppliers" || sheet === "Warehouses" || sheet === "Recipes") {
    return { en: values.name ?? "", ar: values.name ?? "" };
  }
  if (sheet === "Inventory Categories" || sheet === "Ingredients") {
    return { en: firstNonBlank(values.name_en, values.name_ar), ar: firstNonBlank(values.name_ar, values.name_en) };
  }
  if (sheet === "Prep Steps") {
    const instruction = (values.instruction ?? "").trim();
    const short = instruction.length > 60 ? `${instruction.slice(0, 60)}…` : instruction;
    return { en: short, ar: short };
  }
  if (sheet === "Recipe Lines" || sheet === "Modifier Effects") {
    // Labelled from their endpoints by the review (rowLabel); nothing of their own.
    return { en: "", ar: "" };
  }
  if (sheet === "Variants") {
    const en = firstNonBlank(values.variant_label_en, values.variant_label_ar);
    const ar = firstNonBlank(values.variant_label_ar, values.variant_label_en);
    return { en, ar };
  }
  const en = firstNonBlank(values.display_name_en, values.display_name_ar, values.internal_name);
  const ar = firstNonBlank(values.display_name_ar, values.display_name_en, values.internal_name);
  return { en, ar };
}

export function recordLabel(snapshot: ReviewSnapshot, sheet: string, publicId: string): ReviewLabel {
  if (sheet === "Branches") {
    const name = snapshot.permittedBranches.get(publicId) ?? "";
    return { en: name, ar: name };
  }
  const row = snapshot.records[sheet as keyof ReviewSnapshot["records"]]?.get(publicId);
  if (sheet === "Variants" && row) {
    const own = labelOf(sheet, row);
    const product = labelOf("Products", snapshot.records.Products.get(row.product_key ?? ""));
    return {
      en: [product.en, own.en].filter(Boolean).join(" · "),
      ar: [product.ar, own.ar].filter(Boolean).join(" · "),
    };
  }
  return labelOf(sheet, row);
}

export function candidateOf(snapshot: ReviewSnapshot, sheet: string, publicId: string, kind: ReviewCandidate["kind"]): ReviewCandidate {
  const row = snapshot.records[sheet as keyof ReviewSnapshot["records"]]?.get(publicId);
  const candidate: ReviewCandidate = { publicId, label: recordLabel(snapshot, sheet, publicId), kind };
  if (sheet === "Products") {
    candidate.variantCount = variantsOfProduct(snapshot, publicId).length;
  } else if (sheet === "Variants" && row) {
    candidate.detail = [row.amount_minor, row.currency].filter(Boolean).join(" ");
    candidate.isDefault = row.is_default === "TRUE";
  }
  return candidate;
}

/** Existing records in scope whose names loosely match the row's names. Candidates only; never a target. */
export function nameCandidates(snapshot: ReviewSnapshot, sheet: string, parentPublicId: string | null, values: Row) {
  if (!NAME_COLUMNS[sheet] || (PARENT_COLUMN[sheet] && parentPublicId === null)) return [];
  return recordsInScope(snapshot, sheet, parentPublicId)
    .filter(([, record]) => namesCollide(sheet, values, record))
    .map(([publicId]) => candidateOf(snapshot, sheet, publicId, "name_collision"));
}
