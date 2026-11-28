import dictionaryJson from "@/lib/workbook/foodics-menu/dictionary.v1.json";
import { minorDigitsFor } from "@/lib/workbook/foodics-menu/numbers";
import { WorkbookParseError } from "@/lib/workbook/errors";
import { FOODICS_MENU_LIMITS } from "@/lib/workbook/limits";
import { cellKey, columnLetters, parseCellReference, type PackageSheet, type XlsxPackage } from "@/lib/workbook/ooxml";

/* Structural signature of the Foodics-style menu workbook (QOS-216, decision
   D-PROFILE). The profile is recognised from header ranges, populated widths
   and normalised header roles, never from the file name or a sheet name.
   Sheet names are hints for messages only. A layout that is partly there,
   moved or duplicated is refused with a coded error instead of guessed. */

export const FOODICS_MENU_PROFILE = { id: "foodics_menu_v1", version: 1, dictionaryVersion: "1.2" } as const;

export type RegionId =
  | "categories"
  | "products"
  | "ingredients"
  | "product_recipe_lines"
  | "modifiers"
  | "modifier_ingredient_lines"
  | "assignments"
  | "prepared_recipe_lines";

export type RoleSpec = {
  role: string;
  /** Expected column letter, or a letter range for repeated channel price columns. */
  slot: string;
  aliases: string[];
  channelPrice?: boolean;
};

export type RegionSpec = {
  id: RegionId;
  header: { row: number; startColumn: number; width: number };
  exampleRows: number;
  roles: RoleSpec[];
  requiredRoles: string[];
  minMatchedRoles: number;
  identityRoles: string[];
  required: boolean;
  /** Region that must sit on the same sheet as this one (documented together in the issue). */
  sameSheetAs?: RegionId;
  /** ASSUMED sheet names, used in messages only. */
  sheetNameHints: string[];
};

type DictionaryFile = { profile: string; version: number; regions: Record<RegionId, RoleSpec[]> };

const DICTIONARY = dictionaryJson as DictionaryFile;

function column(letter: string) {
  return parseCellReference(`${letter}1`)!.column;
}

function region(
  id: RegionId,
  headerRef: string,
  exampleRows: number,
  options: Omit<RegionSpec, "id" | "header" | "exampleRows" | "roles">,
): RegionSpec {
  const [start, end] = headerRef.split(":");
  const from = parseCellReference(start!)!;
  const to = parseCellReference(end!)!;
  return {
    id,
    header: { row: from.row, startColumn: from.column, width: to.column - from.column + 1 },
    exampleRows,
    roles: DICTIONARY.regions[id],
    ...options,
  };
}

/* Coordinates verified in QOS-216: header range, example rows (skipped by
   position), first input row = header row + example rows + 1. */
export const REGION_SPECS: readonly RegionSpec[] = [
  region("categories", "F4:G4", 3, {
    requiredRoles: ["name_en"],
    minMatchedRoles: 1,
    identityRoles: ["name_en", "name_ar"],
    required: true,
    sheetNameHints: ["Categories"],
  }),
  region("products", "D6:V6", 4, {
    requiredRoles: ["name_en", "price", "category"],
    minMatchedRoles: 6,
    identityRoles: ["name_en", "name_ar"],
    required: true,
    sheetNameHints: ["Products", "Items", "Menu"],
  }),
  region("ingredients", "D7:J7", 10, {
    requiredRoles: ["name_en"],
    minMatchedRoles: 3,
    identityRoles: ["name_en", "name_ar"],
    required: false,
    sheetNameHints: ["Ingredients", "Inventory Items"],
  }),
  region("product_recipe_lines", "L7:N7", 7, {
    requiredRoles: ["product", "ingredient", "quantity"],
    minMatchedRoles: 3,
    identityRoles: ["product", "ingredient"],
    required: false,
    sameSheetAs: "ingredients",
    sheetNameHints: ["Ingredients", "Inventory Items"],
  }),
  region("modifiers", "F8:O8", 4, {
    requiredRoles: ["group_en", "option_en", "price"],
    minMatchedRoles: 4,
    identityRoles: ["group_en", "option_en"],
    required: false,
    sheetNameHints: ["Modifiers", "Modifier Options"],
  }),
  region("modifier_ingredient_lines", "R8:T8", 4, {
    requiredRoles: ["option", "ingredient", "quantity"],
    minMatchedRoles: 3,
    identityRoles: ["option", "ingredient"],
    required: false,
    sameSheetAs: "modifiers",
    sheetNameHints: ["Modifiers", "Modifier Options"],
  }),
  region("assignments", "D6:I6", 2, {
    requiredRoles: ["product", "group"],
    minMatchedRoles: 3,
    identityRoles: ["product", "group"],
    required: false,
    sheetNameHints: ["Product Modifiers", "Assignments", "Product Groups"],
  }),
  region("prepared_recipe_lines", "I6:K6", 3, {
    requiredRoles: ["prepared_item", "ingredient", "quantity"],
    minMatchedRoles: 3,
    identityRoles: ["prepared_item", "ingredient"],
    required: false,
    sheetNameHints: ["Prepared Items", "Sub Recipes", "Semi Finished"],
  }),
];

export function regionSpec(id: RegionId) {
  return REGION_SPECS.find((spec) => spec.id === id)!;
}

export function regionRef(startColumn: number, startRow: number, width: number, endRow = startRow) {
  return `${columnLetters(startColumn)}${startRow}:${columnLetters(startColumn + width - 1)}${endRow}`;
}

/** First input row of a region: after the header and the documented example rows. */
export function dataStartRow(spec: RegionSpec, headerRow = spec.header.row) {
  return headerRow + spec.exampleRows + 1;
}

/**
 * NFKC, lower case, `_ - /` as spaces, only Latin and Arabic letters, digits,
 * `%` and spaces kept, spaces collapsed. `Price (AED)*` becomes `price aed`.
 */
export function normalizeHeader(text: string) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    // Template typo observed on the original workbook (QOS-216).
    .replaceAll("languge", "language")
    .replaceAll("preperation", "preparation")
    .replace(/[_\-/]/g, " ")
    .replace(/[^\p{Script=Latin}\p{Script=Arabic}0-9%\s]/gu, " ")
    .replace(/[٠-٩۰-۹]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * First meaningful line of a header, without parenthetical help or
 * `example:` copy. The original Foodics headers are often two or three
 * lines of guidance above a short title.
 */
export function primaryHeaderLabel(text: string) {
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? text.trim();
  // Do not strip parentheses here: `Name (AR)` and `Price (AED)` must stay
  // distinct from `Name` / `Price`. Help text on later lines is already dropped.
  return firstLine.split(/\bexample\b/i)[0] ?? firstLine;
}

function variantsOf(text: string) {
  const parts = text.split(/[/|]/).map(normalizeHeader).filter(Boolean);
  return [...new Set([normalizeHeader(text), ...parts])];
}

/** The whole header and, for bilingual labels like `Name (EN) / الاسم`, each part. */
function headerVariants(text: string) {
  return [...new Set([...variantsOf(text), ...variantsOf(primaryHeaderLabel(text))])];
}

/**
 * Prefer a match against the full header (so a second-line "in localized
 * language" is not lost). Fall back to the first-line/primary label when the
 * full text includes example or help copy that would miss the alias. The
 * longest matching alias wins when two roles both fit.
 */
function matchHeaderRole(spec: RegionSpec, text: string) {
  const pick = (variants: string[]) => {
    let best: { role: string; length: number } | null = null;
    for (const candidate of spec.roles) {
      if (candidate.channelPrice) continue;
      const hit = candidate.aliases.find((alias) => variants.includes(alias));
      if (hit && (!best || hit.length > best.length)) {
        best = { role: candidate.role, length: hit.length };
      }
    }
    return best?.role ?? null;
  };
  return pick(variantsOf(text)) ?? pick(variantsOf(primaryHeaderLabel(text)));
}

const NON_CHANNEL_PRICE = new Set([
  "price",
  "base price",
  "cost price",
  "product price",
  "modifier option price",
  "option price",
  "selling price",
  "default price",
  "price aed",
]);

/** `dine in price (AED)` → `dine in`; null when the header is not a channel price. */
export function channelLabelOf(normalized: string) {
  const tokens = normalized.split(" ");
  if (!tokens.includes("price") || NON_CHANNEL_PRICE.has(normalized)) {
    return null;
  }
  const aggregator = /\baggregator\s+(\d+)\b/.exec(normalized);
  if (aggregator) {
    return `aggregator ${aggregator[1]}`;
  }
  const label = tokens
    .filter((token) => token !== "price" && token !== "%" && token !== "of" && minorDigitsFor(token) === null)
    .join(" ")
    .trim();
  return label || null;
}

export type MatchedColumn = {
  column: number;
  header: string;
  normalized: string;
  /** Role, `channel_price:<label>`, or null for an unmapped header. */
  role: string | null;
};

function slotColumns(slot: string) {
  const [from, to = from] = slot.split("-");
  const start = column(from!);
  const end = column(to!);
  return { start, end };
}

/** Matches the header cells of one region position to roles. */
export function matchRegionHeaders(sheet: PackageSheet, spec: RegionSpec, headerRow: number, startColumn: number) {
  const width = spec.header.width;
  const columns: MatchedColumn[] = [];
  let populated = 0;
  for (let offset = 0; offset < width; offset += 1) {
    const columnNumber = startColumn + offset;
    const cell = sheet.cells.get(cellKey(headerRow, columnNumber));
    // Cached display text is used for header labels only. Formulas are never
    // evaluated; a formula cell with empty or error cache is still unpopulated.
    const header = cell && cell.kind !== "error" ? cell.text.trim() : "";
    if (header) populated += 1;
    columns.push({ column: columnNumber, header, normalized: normalizeHeader(header), role: null });
  }

  // Candidate roles per header; position decides only between equal candidates.
  const claims = new Map<string, MatchedColumn[]>();
  for (const entry of columns) {
    if (!entry.header) continue;
    const variants = headerVariants(entry.header);
    let role = matchHeaderRole(spec, entry.header);
    if (!role && spec.roles.some((candidate) => candidate.channelPrice)) {
      const label = variants.map(channelLabelOf).find((value) => value);
      if (label) role = `channel_price:${label}`;
    }
    if (role) {
      claims.set(role, [...(claims.get(role) ?? []), entry]);
    }
  }
  for (const [role, entries] of claims) {
    const baseRole = role.startsWith("channel_price:") ? "channel_price" : role;
    const slot = spec.roles.find((candidate) => candidate.role === baseRole)!.slot;
    const { start, end } = slotColumns(slot);
    const expectedStart = startColumn + (start - spec.header.startColumn);
    const expectedEnd = startColumn + (end - spec.header.startColumn);
    const winner = entries.find((entry) => entry.column >= expectedStart && entry.column <= expectedEnd) ?? entries[0]!;
    winner.role = role;
  }

  const matchedRoles = [...new Set(columns.map((entry) => entry.role).filter((role): role is string => Boolean(role)))];
  const baseRoles = new Set(matchedRoles.map((role) => (role.startsWith("channel_price:") ? "channel_price" : role)));
  const missingRequired = spec.requiredRoles.filter((role) => !baseRoles.has(role));
  const matches = populated === width && missingRequired.length === 0 && baseRoles.size >= spec.minMatchedRoles;
  return { columns, populated, matchedRoles, baseRoles, missingRequired, matches };
}

export type MatchedRegion = {
  id: RegionId;
  sheet: string;
  headerRow: number;
  startColumn: number;
  width: number;
  columns: MatchedColumn[];
};

export type IgnoredSheet = { sheet: string; reason: "credentials" | "guidance" };

export type FoodicsMenuLayout = {
  regions: MatchedRegion[];
  absentRegions: RegionId[];
  ignoredSheets: IgnoredSheet[];
};

type PartialPresence = {
  region: RegionId;
  sheet: string;
  foundRow?: number;
  foundColumn?: string;
  missingHeaders: string[];
  populated: number;
};

/** Where a region shows up on a sheet without matching: moved header, shifted columns, or changed labels. */
function partialPresence(sheet: PackageSheet, spec: RegionSpec): PartialPresence | null {
  const { row, startColumn, width } = spec.header;
  const strong = (probe: ReturnType<typeof matchRegionHeaders>) =>
    probe.populated >= Math.ceil(width / 2) && probe.missingRequired.length === 0 && probe.baseRoles.size >= 2;
  // A full match elsewhere is the clearest diagnosis; otherwise the nearest strong one.
  const probes: Array<{ row: number; column: number; probe: ReturnType<typeof matchRegionHeaders> }> = [];
  for (let probeRow = 1; probeRow <= FOODICS_MENU_LIMITS.maxHeaderProbeRows; probeRow += 1) {
    if (probeRow !== row) probes.push({ row: probeRow, column: startColumn, probe: matchRegionHeaders(sheet, spec, probeRow, startColumn) });
  }
  for (const shift of [-1, 1, -2, 2, -3, 3]) {
    if (startColumn + shift >= 1) {
      probes.push({ row, column: startColumn + shift, probe: matchRegionHeaders(sheet, spec, row, startColumn + shift) });
    }
  }
  const found = probes.find((entry) => entry.probe.matches) ?? probes.find((entry) => strong(entry.probe));
  if (found) {
    return {
      region: spec.id,
      sheet: sheet.name,
      foundRow: found.row,
      ...(found.column !== startColumn ? { foundColumn: columnLetters(found.column) } : {}),
      missingHeaders: [],
      populated: found.probe.populated,
    };
  }
  // Labels changed in place: report which required roles are missing.
  const atSlot = matchRegionHeaders(sheet, spec, row, startColumn);
  if (atSlot.populated >= Math.ceil(width / 2) && atSlot.baseRoles.size >= 2) {
    return { region: spec.id, sheet: sheet.name, missingHeaders: atSlot.missingRequired, populated: atSlot.populated };
  }
  return null;
}

const CREDENTIAL_SHEET_NAMES = new Set(["users", "user", "staff", "accounts", "logins"]);
const CREDENTIAL_HEADERS = new Set(["password", "pin", "passcode", "pin code", "api token", "secret"]);

/** True when a sheet name marks an account sheet (Users, Staff, Logins, …). */
export function classifyIgnoredSheetName(name: string) {
  // "7- Users" on the original workbook must be treated as an account sheet.
  return normalizeHeader(name)
    .split(" ")
    .some((token) => CREDENTIAL_SHEET_NAMES.has(token));
}

const CREDENTIAL_TOKENS = new Set(["password", "passcode", "pin", "secret"]);

/** True when header text names a credential (password, PIN, passcode, API token, secret). */
export function classifyIgnoredSheetHeader(text: string) {
  return headerVariants(text).some(
    (variant) =>
      CREDENTIAL_HEADERS.has(variant) || variant.split(" ").some((token) => CREDENTIAL_TOKENS.has(token)),
  );
}

/**
 * Credentials or guidance. Reads only header text in rows 1–15 and stops at
 * the first credential word; nothing from the sheet is copied anywhere.
 */
export function classifyIgnoredSheet(sheet: PackageSheet): IgnoredSheet["reason"] {
  if (classifyIgnoredSheetName(sheet.name)) {
    return "credentials";
  }
  for (const [key, cell] of sheet.cells) {
    const row = Number(key.slice(0, key.indexOf(":")));
    // Header labels on the original workbook are Localization formulas; read
    // the cached display text only. Formulas are never evaluated.
    if (row > FOODICS_MENU_LIMITS.maxHeaderProbeRows || cell.kind === "error" || !cell.text.trim()) continue;
    if (classifyIgnoredSheetHeader(cell.text)) {
      return "credentials";
    }
  }
  return "guidance";
}

function layoutError(code: "source_layout_partial" | "source_layout_ambiguous", message: string, first: Record<string, string | number>, details: unknown[]) {
  return new WorkbookParseError(code, message, { ...first, details: JSON.stringify(details).slice(0, 2000) });
}

function expectedRef(spec: RegionSpec) {
  return regionRef(spec.header.startColumn, spec.header.row, spec.header.width);
}

/**
 * `match` returns the layout; `none` returns null so the caller falls back
 * to the legacy profile; anything in between throws `source_layout_partial`
 * or `source_layout_ambiguous`.
 */
export function detectFoodicsMenuLayout(pkg: XlsxPackage): FoodicsMenuLayout | null {
  const matched = new Map<RegionId, MatchedRegion[]>();
  const partial = new Map<RegionId, PartialPresence[]>();

  for (const sheet of pkg.sheets) {
    if (sheet.cells.size === 0) continue;
    for (const spec of REGION_SPECS) {
      const result = matchRegionHeaders(sheet, spec, spec.header.row, spec.header.startColumn);
      if (result.matches) {
        matched.set(spec.id, [
          ...(matched.get(spec.id) ?? []),
          {
            id: spec.id,
            sheet: sheet.name,
            headerRow: spec.header.row,
            startColumn: spec.header.startColumn,
            width: spec.header.width,
            columns: result.columns,
          },
        ]);
        continue;
      }
      const found = partialPresence(sheet, spec);
      if (found) {
        partial.set(spec.id, [...(partial.get(spec.id) ?? []), found]);
      }
    }
  }

  if (matched.size === 0 && partial.size === 0) {
    return null;
  }

  const ambiguous = REGION_SPECS.filter((spec) => (matched.get(spec.id)?.length ?? 0) > 1);
  if (ambiguous.length > 0) {
    const details = ambiguous.map((spec) => ({ region: spec.id, sheets: matched.get(spec.id)!.map((entry) => entry.sheet) }));
    const first = details[0]!;
    throw layoutError(
      "source_layout_ambiguous",
      `The ${first.region} layout appears on more than one sheet (${first.sheets.join(", ")}).`,
      { region: first.region, sheet: first.sheets.join(", "), expectedRef: expectedRef(regionSpec(first.region)) },
      details,
    );
  }

  const failures: Array<Record<string, string | number>> = [];
  for (const spec of REGION_SPECS) {
    const hit = matched.get(spec.id)?.[0];
    if (hit) continue;
    const near = partial.get(spec.id)?.[0];
    if (near) {
      failures.push({
        region: spec.id,
        sheet: near.sheet,
        expectedRef: expectedRef(spec),
        ...(near.foundRow !== undefined ? { foundRow: near.foundRow } : {}),
        ...(near.foundColumn ? { foundColumn: near.foundColumn } : {}),
        missingHeaders: near.missingHeaders.join(", "),
        populated: near.populated,
        width: spec.header.width,
      });
    } else if (spec.required) {
      failures.push({
        region: spec.id,
        sheet: "",
        expectedRef: expectedRef(spec),
        missingHeaders: spec.requiredRoles.join(", "),
        populated: 0,
        width: spec.header.width,
      });
    }
  }
  for (const spec of REGION_SPECS) {
    if (!spec.sameSheetAs) continue;
    const self = matched.get(spec.id)?.[0];
    const partner = matched.get(spec.sameSheetAs)?.[0];
    if ((self || partner) && self?.sheet !== partner?.sheet && !failures.some((entry) => entry.region === spec.id)) {
      failures.push({
        region: spec.id,
        sheet: self?.sheet ?? partner?.sheet ?? "",
        expectedRef: expectedRef(spec),
        missingHeaders: self ? "" : spec.requiredRoles.join(", "),
        populated: self ? spec.header.width : 0,
        width: spec.header.width,
      });
    }
  }
  if (failures.length > 0) {
    const first = failures[0]!;
    throw layoutError(
      "source_layout_partial",
      `The workbook looks like the Foodics menu layout, but the ${first.region} table (${first.expectedRef}) is missing, moved or changed.`,
      first,
      failures,
    );
  }

  const regions = REGION_SPECS.flatMap((spec) => matched.get(spec.id) ?? []);
  const hosting = new Set(regions.map((entry) => entry.sheet));
  return {
    regions,
    absentRegions: REGION_SPECS.filter((spec) => !matched.has(spec.id)).map((spec) => spec.id),
    ignoredSheets: pkg.sheets
      .filter((sheet) => !hosting.has(sheet.name))
      .map((sheet) => ({ sheet: sheet.name, reason: classifyIgnoredSheet(sheet) })),
  };
}
