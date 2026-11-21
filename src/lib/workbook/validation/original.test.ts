import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { cellKey, readXlsxPackage } from "@/lib/workbook/ooxml";
import { WORKBOOK_LIMITS } from "@/lib/workbook/limits";
import { parseWorkbookUpload } from "@/lib/workbook/reader";
import { toReviewInput } from "@/lib/workbook/validation/input";
import { reviewWorkbook } from "@/lib/workbook/validation/review";
import { emptySnapshot, snapshotFrom } from "@/lib/workbook/validation/test-support";

/* QOS-194 no-op check against the client's original Foodics template. The
   file is private and never committed: the test runs only when
   QOS_216_SOURCE_XLSX or /workspace/qos-phase2/private/ provides it, and
   fails loudly if that file is not the SHA-verified original. The template
   has no business rows, so a review proposes nothing and no account-sheet
   text ever becomes a candidate. */

const ORIGINAL_SHA256 = "2a73c4f19c98e35803b026038b08439a5f0f77070f88e59e4356623ded3e4cd3";
const PRIVATE_DIR = "/workspace/qos-phase2/private";

function originalPath() {
  const fromEnv = process.env.QOS_216_SOURCE_XLSX;
  if (fromEnv) return fromEnv;
  if (!existsSync(PRIVATE_DIR)) return null;
  const candidate = readdirSync(PRIVATE_DIR).find((name) => name.toLowerCase().endsWith(".xlsx"));
  return candidate ? path.join(PRIVATE_DIR, candidate) : null;
}

const source = originalPath();

describe("original client workbook review (local only, never committed)", () => {
  it.skipIf(!source)("reviews to zero rows and zero proposals, with the account sheet listed as ignored", async () => {
    const bytes = readFileSync(source!);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(ORIGINAL_SHA256);
    const parsed = await parseWorkbookUpload(
      { fileName: path.basename(source!), bytes },
      { tenantCurrency: "AED", tenantPublicId: "ten_quotes_dev", brandPublicIds: ["brd_quotes"], brandPublicId: "brd_quotes" },
    );
    const input = toReviewInput(parsed, { tenantPublicId: "ten_quotes_dev", brandPublicId: "brd_quotes", currency: "AED" });

    for (const snapshot of [emptySnapshot(), snapshotFrom()]) {
      const review = reviewWorkbook(input, snapshot);
      expect(review.counts.rows).toBe(0);
      expect(review.counts.create).toBe(0);
      expect(review.counts.update).toBe(0);
      expect(review.rows.flatMap((row) => row.candidates ?? [])).toEqual([]);
      const credentials = (review.context.ignoredSheets ?? []).filter((sheet) => sheet.reason === "credentials");
      expect(credentials.length).toBeGreaterThan(0);

      const pkg = readXlsxPackage(bytes, WORKBOOK_LIMITS.ooxml);
      const serialized = JSON.stringify({ ...review, context: { ...review.context, ignoredSheets: [] } });
      for (const { sheet: name } of credentials) {
        const sheet = pkg.sheets.find((entry) => entry.name === name)!;
        for (let row = 1; row <= 15; row += 1) {
          for (let column = 1; column <= 30; column += 1) {
            const text = sheet.cells.get(cellKey(row, column))?.text.trim();
            if (text && text.length > 3) expect(serialized.includes(`"${text}"`), `${name}!${row}:${column}`).toBe(false);
          }
        }
      }
    }
  });
});
