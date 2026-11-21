import path from "node:path/posix";

import { WorkbookParseError } from "@/lib/workbook/errors";
import { parseXml } from "@/lib/workbook/xml";
import { openZip, type ZipArchive, type ZipLimits } from "@/lib/workbook/zip";

/* Reads the parts of an XLSX package that the workbook profiles need:
   sheet names and order, named tables (name, range, columns) and cell
   values. Formulas are never evaluated: a formula cell is reported as such,
   and its cached result is kept only so callers can show that a value was
   withheld. Absolute and relative part targets, prefixed and default
   namespaces and byte-order marks are all accepted, because real workbooks
   (including the pack's reference template) use them. */

export type OoxmlLimits = {
  zip: ZipLimits;
  maxSheets: number;
  maxTablesPerSheet: number;
  maxValuedCells: number;
  maxSharedStrings: number;
};

export type CellKind = "string" | "number" | "boolean" | "date" | "error";

export type SheetCell = {
  kind: CellKind;
  text: string;
  formula: boolean;
};

export type CellRange = {
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
};

export type SheetTable = {
  name: string;
  ref: string;
  range: CellRange;
  headerRowCount: number;
  totalsRowCount: number;
  columnNames: string[];
};

export type PackageSheet = {
  name: string;
  state: "visible" | "hidden" | "veryHidden";
  tables: SheetTable[];
  cells: Map<string, SheetCell>;
};

export type XlsxPackage = {
  sheets: PackageSheet[];
};

const RELATIONSHIP_TYPES = {
  officeDocument: "/officeDocument",
  worksheet: "/worksheet",
  sharedStrings: "/sharedStrings",
  styles: "/styles",
  table: "/table",
} as const;

const MAX_ROW = 1_048_576;
const MAX_COLUMN = 16_384;

export function cellKey(row: number, column: number) {
  return `${row}:${column}`;
}

export function columnLetters(column: number) {
  let value = column;
  let letters = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}

export function parseCellReference(reference: string) {
  const match = /^\$?([A-Z]{1,3})\$?(\d{1,7})$/i.exec(reference.trim());
  if (!match) {
    return null;
  }
  let column = 0;
  for (const letter of match[1]!.toUpperCase()) {
    column = column * 26 + (letter.charCodeAt(0) - 64);
  }
  const row = Number.parseInt(match[2]!, 10);
  if (row < 1 || row > MAX_ROW || column < 1 || column > MAX_COLUMN) {
    return null;
  }
  return { row, column };
}

export function parseRange(ref: string): CellRange | null {
  const [start, end = start] = ref.split(":");
  const from = start ? parseCellReference(start) : null;
  const to = end ? parseCellReference(end) : null;
  if (!from || !to || to.row < from.row || to.column < from.column) {
    return null;
  }
  return { startRow: from.row, startColumn: from.column, endRow: to.row, endColumn: to.column };
}

function malformed(detail: string): never {
  throw new WorkbookParseError("malformed_workbook", `The workbook is not a readable XLSX file (${detail}).`);
}

function readXmlPart(archive: ZipArchive, name: string) {
  const bytes = archive.read(name);
  return bytes.toString("utf8");
}

function resolveTarget(sourcePart: string, target: string) {
  if (target.startsWith("/")) {
    return target.slice(1);
  }
  const resolved = path.normalize(path.join(path.dirname(sourcePart), target));
  return resolved.startsWith("../") || resolved === ".." ? malformed("relationship target") : resolved;
}

function relationshipsPartFor(part: string) {
  return path.join(path.dirname(part), "_rels", `${path.basename(part)}.rels`);
}

function readRelationships(archive: ZipArchive, part: string) {
  const relsPart = relationshipsPartFor(part);
  const relationships: Array<{ id: string; type: string; target: string; external: boolean }> = [];
  if (!archive.has(relsPart)) {
    return relationships;
  }
  parseXml(readXmlPart(archive, relsPart), {
    open(name, attributes) {
      if (name === "Relationship" && attributes.Id && attributes.Target) {
        relationships.push({
          id: attributes.Id,
          type: attributes.Type ?? "",
          target: attributes.Target,
          external: attributes.TargetMode === "External",
        });
      }
    },
  });
  return relationships;
}

/* Excel writes control characters in strings as _xHHHH_. */
function decodeSpreadsheetEscapes(value: string) {
  return value.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

/** Text of a <si> or <is> element, skipping phonetic runs. */
function createRichTextCollector() {
  let depthInPhonetic = 0;
  let inText = false;
  let buffer = "";
  return {
    open(name: string) {
      if (name === "rPh") depthInPhonetic += 1;
      if (name === "t" && depthInPhonetic === 0) inText = true;
    },
    close(name: string) {
      if (name === "rPh") depthInPhonetic -= 1;
      if (name === "t") inText = false;
    },
    text(value: string) {
      if (inText) buffer += value;
    },
    take() {
      const value = decodeSpreadsheetEscapes(buffer);
      buffer = "";
      return value;
    },
  };
}

function readSharedStrings(archive: ZipArchive, part: string | null, limits: OoxmlLimits) {
  const strings: string[] = [];
  if (!part || !archive.has(part)) {
    return strings;
  }
  const collector = createRichTextCollector();
  let inItem = false;
  parseXml(readXmlPart(archive, part), {
    open(name) {
      if (name === "si") {
        inItem = true;
        return;
      }
      if (inItem) collector.open(name);
    },
    close(name) {
      if (name === "si") {
        inItem = false;
        strings.push(collector.take());
        if (strings.length > limits.maxSharedStrings) {
          throw new WorkbookParseError("too_much_text", "The workbook contains too many text values.", {
            max: limits.maxSharedStrings,
          });
        }
        return;
      }
      if (inItem) collector.close(name);
    },
    text(value) {
      if (inItem) collector.text(value);
    },
  });
  return strings;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function isDateFormatCode(code: string) {
  const withoutLiterals = code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, "");
  return /[dmyhs]/i.test(withoutLiterals) && !/^[@\s]*$/.test(withoutLiterals);
}

function readDateStyles(archive: ZipArchive, part: string | null) {
  const dateStyles = new Set<number>();
  if (!part || !archive.has(part)) {
    return dateStyles;
  }
  const customFormats = new Map<number, string>();
  const xfFormats: number[] = [];
  let inCellXfs = false;
  parseXml(readXmlPart(archive, part), {
    open(name, attributes) {
      if (name === "numFmt" && attributes.numFmtId) {
        customFormats.set(Number(attributes.numFmtId), attributes.formatCode ?? "");
      } else if (name === "cellXfs") {
        inCellXfs = true;
      } else if (name === "xf" && inCellXfs) {
        xfFormats.push(Number(attributes.numFmtId ?? 0));
      }
    },
    close(name) {
      if (name === "cellXfs") inCellXfs = false;
    },
  });
  xfFormats.forEach((formatId, styleIndex) => {
    const custom = customFormats.get(formatId);
    if (custom !== undefined ? isDateFormatCode(custom) : BUILTIN_DATE_FORMATS.has(formatId)) {
      dateStyles.add(styleIndex);
    }
  });
  return dateStyles;
}

function readTable(archive: ZipArchive, part: string): SheetTable {
  let table: SheetTable | null = null;
  parseXml(readXmlPart(archive, part), {
    open(name, attributes) {
      if (name === "table") {
        const ref = attributes.ref ?? "";
        const range = parseRange(ref);
        if (!range) {
          malformed(`table range ${ref}`);
        }
        table = {
          name: attributes.displayName || attributes.name || "",
          ref,
          range,
          headerRowCount: Number(attributes.headerRowCount ?? 1),
          totalsRowCount: Number(attributes.totalsRowCount ?? 0),
          columnNames: [],
        };
      } else if (name === "tableColumn" && table) {
        (table as SheetTable).columnNames.push(decodeSpreadsheetEscapes(attributes.name ?? ""));
      }
    },
  });
  if (!table) {
    return malformed(`table part ${part}`);
  }
  return table;
}

/* Excel serial date (1900 system) to ISO text. Whole days give a date,
   fractions add the time. */
export function excelSerialToIso(serial: number) {
  const milliseconds = Math.round((serial - 25569) * 86_400_000);
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) {
    return String(serial);
  }
  const iso = date.toISOString();
  return Number.isInteger(serial) ? iso.slice(0, 10) : iso.slice(0, 19);
}

function normalizeNumberText(raw: string) {
  const trimmed = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return trimmed;
  }
  return Number.isInteger(value) && !Number.isSafeInteger(value) ? trimmed : String(value);
}

function readSheetCells(
  archive: ZipArchive,
  part: string,
  sharedStrings: string[],
  dateStyles: Set<number>,
  budget: { cells: number },
  limits: OoxmlLimits,
) {
  const cells = new Map<string, SheetCell>();
  const inline = createRichTextCollector();
  let currentRow = 0;
  let lastColumn = 0;
  let cell: {
    row: number;
    column: number;
    type: string;
    style: number;
    value: string;
    hasValue: boolean;
    formula: boolean;
  } | null = null;
  let collecting: "v" | "is" | null = null;

  parseXml(readXmlPart(archive, part), {
    open(name, attributes) {
      if (name === "row") {
        const rowNumber = attributes.r ? Number.parseInt(attributes.r, 10) : currentRow + 1;
        if (!Number.isInteger(rowNumber) || rowNumber < 1 || rowNumber > MAX_ROW) {
          malformed("row number");
        }
        currentRow = rowNumber;
        lastColumn = 0;
        return;
      }
      if (name === "c") {
        const reference = attributes.r ? parseCellReference(attributes.r) : null;
        if (attributes.r && !reference) {
          malformed(`cell reference ${attributes.r}`);
        }
        const row = reference?.row ?? currentRow;
        const column = reference?.column ?? lastColumn + 1;
        if (row < 1 || column > MAX_COLUMN) {
          malformed("cell position");
        }
        lastColumn = column;
        cell = {
          row,
          column,
          type: attributes.t ?? "n",
          style: Number(attributes.s ?? 0),
          value: "",
          hasValue: false,
          formula: false,
        };
        return;
      }
      if (!cell) return;
      if (name === "f") {
        cell.formula = true;
      } else if (name === "v") {
        collecting = "v";
        cell.hasValue = true;
      } else if (name === "is") {
        collecting = "is";
        cell.hasValue = true;
      } else if (collecting === "is") {
        inline.open(name);
      }
    },
    close(name) {
      if (name === "v" || name === "is") {
        if (name === "is" && cell) cell.value = inline.take();
        collecting = null;
        return;
      }
      if (collecting === "is") {
        inline.close(name);
        return;
      }
      if (name !== "c" || !cell) return;

      const finished = cell;
      cell = null;
      if (!finished.hasValue && !finished.formula) {
        return;
      }

      let kind: CellKind = "string";
      let text = finished.value;
      switch (finished.type) {
        case "s": {
          const index = Number.parseInt(finished.value, 10);
          const shared = sharedStrings[index];
          if (shared === undefined) {
            malformed("shared string index");
          }
          text = shared;
          break;
        }
        case "inlineStr":
        case "str":
          text = decodeSpreadsheetEscapes(finished.value);
          break;
        case "b":
          kind = "boolean";
          text = finished.value.trim() === "1" ? "TRUE" : finished.value.trim() === "0" ? "FALSE" : finished.value;
          break;
        case "e":
          kind = "error";
          break;
        case "d":
          kind = "date";
          break;
        default: {
          if (!finished.hasValue) {
            text = "";
            kind = "number";
            break;
          }
          const numeric = Number(finished.value);
          if (dateStyles.has(finished.style) && Number.isFinite(numeric)) {
            kind = "date";
            text = excelSerialToIso(numeric);
          } else {
            kind = "number";
            text = normalizeNumberText(finished.value);
          }
        }
      }

      budget.cells += 1;
      if (budget.cells > limits.maxValuedCells) {
        throw new WorkbookParseError("too_much_text", "The workbook contains too many filled cells.", {
          max: limits.maxValuedCells,
        });
      }
      cells.set(cellKey(finished.row, finished.column), {
        kind,
        text,
        formula: finished.formula,
      });
    },
    text(value) {
      if (!cell) return;
      if (collecting === "v") {
        cell.value += value;
      } else if (collecting === "is") {
        inline.text(value);
      }
    },
  });

  return cells;
}

export function readXlsxPackage(bytes: Buffer, limits: OoxmlLimits): XlsxPackage {
  const archive = openZip(bytes, limits.zip);

  const rootRelationships = readRelationships(archive, "");
  const officeDocument = rootRelationships.find((relationship) =>
    relationship.type.endsWith(RELATIONSHIP_TYPES.officeDocument),
  );
  const workbookPart = officeDocument ? resolveTarget("", officeDocument.target) : "xl/workbook.xml";
  if (!archive.has(workbookPart)) {
    malformed("no workbook part");
  }

  const declaredSheets: Array<{ name: string; state: PackageSheet["state"]; relationshipId: string }> = [];
  parseXml(readXmlPart(archive, workbookPart), {
    open(name, attributes) {
      if (name === "sheet") {
        const state = attributes.state === "hidden" || attributes.state === "veryHidden" ? attributes.state : "visible";
        declaredSheets.push({
          name: attributes.name ?? "",
          state,
          relationshipId: attributes.id ?? "",
        });
      }
    },
  });

  if (declaredSheets.length > limits.maxSheets) {
    throw new WorkbookParseError("too_many_sheets", `The workbook has more than ${limits.maxSheets} sheets.`, {
      max: limits.maxSheets,
    });
  }

  const workbookRelationships = readRelationships(archive, workbookPart);
  const relatedPart = (type: string) => {
    const relationship = workbookRelationships.find((candidate) => candidate.type.endsWith(type));
    return relationship && !relationship.external ? resolveTarget(workbookPart, relationship.target) : null;
  };
  const sharedStrings = readSharedStrings(archive, relatedPart(RELATIONSHIP_TYPES.sharedStrings), limits);
  const dateStyles = readDateStyles(archive, relatedPart(RELATIONSHIP_TYPES.styles));
  const budget = { cells: 0 };

  const sheets: PackageSheet[] = [];
  for (const declared of declaredSheets) {
    const relationship = workbookRelationships.find((candidate) => candidate.id === declared.relationshipId);
    if (!relationship || relationship.external || !relationship.type.endsWith(RELATIONSHIP_TYPES.worksheet)) {
      // Chart sheets and dialog sheets carry no cells; keep them visible by name only.
      sheets.push({ name: declared.name, state: declared.state, tables: [], cells: new Map() });
      continue;
    }
    const sheetPart = resolveTarget(workbookPart, relationship.target);
    if (!archive.has(sheetPart)) {
      malformed(`missing sheet ${declared.name}`);
    }

    const tableParts = readRelationships(archive, sheetPart)
      .filter((candidate) => !candidate.external && candidate.type.endsWith(RELATIONSHIP_TYPES.table))
      .map((candidate) => resolveTarget(sheetPart, candidate.target));
    if (tableParts.length > limits.maxTablesPerSheet) {
      throw new WorkbookParseError("too_many_sheets", `A sheet has more than ${limits.maxTablesPerSheet} tables.`, {
        max: limits.maxTablesPerSheet,
      });
    }

    sheets.push({
      name: declared.name,
      state: declared.state,
      tables: tableParts.map((tablePart) => readTable(archive, tablePart)),
      cells: readSheetCells(archive, sheetPart, sharedStrings, dateStyles, budget, limits),
    });
  }

  return { sheets };
}
