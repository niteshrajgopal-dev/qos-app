import type { OoxmlLimits } from "@/lib/workbook/ooxml";

/**
 * Bounded limits for the expanded multi-sheet profile. They are deliberately
 * conservative and sit in one place so they can be raised later: the pack's
 * reference workbook is 656 KB packed, 98 parts, 31 sheets and at most 500
 * rows per table. The legacy flat profile keeps IMPORT_LIMITS unchanged; the
 * per-cell length matches it (asserted in limits.test.ts).
 */
export const WORKBOOK_LIMITS = {
  maxFileBytes: 8 * 1024 * 1024,
  maxRowsPerTable: 1000,
  maxColumnsPerTable: 40,
  maxCellLength: 2000,
  maxTotalTextLength: 4_000_000,
  ooxml: {
    zip: {
      maxEntries: 512,
      maxEntryBytes: 16 * 1024 * 1024,
      maxTotalBytes: 64 * 1024 * 1024,
    },
    maxSheets: 64,
    maxTablesPerSheet: 8,
    maxValuedCells: 250_000,
    maxSharedStrings: 250_000,
  } satisfies OoxmlLimits,
} as const;

/**
 * Bounds for the Foodics menu source profile (QOS-216). Rows per region match
 * the canonical read-back ceiling so a converted workbook can be read again.
 * Typed identity text past the bound is refused, never silently cut off.
 */
export const FOODICS_MENU_LIMITS = {
  maxRowsPerRegion: 1000,
  maxHeaderProbeRows: 15,
  maxSourceMapRows: 10_000,
  maxChannelLabels: 12,
} as const;
