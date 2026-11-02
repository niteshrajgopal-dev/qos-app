import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(process.cwd(), "src");

const AUDITED_SURFACES = [
  "app/tenants/[tenantId]/catalogue/products/product-editor.tsx",
  "app/tenants/[tenantId]/catalogue/products/product-edit-screen.tsx",
];

const FORBIDDEN_LITERALS = [
  '"Cancel"',
  '"Keep editing"',
  '"Discard"',
  "readStoredStaffLocale(",
  '"General information"',
  '"English copy"',
  '"Arabic copy"',
  '"Internal name"',
  '"Unsaved changes"',
];

describe("staff admin audited surfaces", () => {
  for (const relative of AUDITED_SURFACES) {
    it(`avoid hardcoded English chrome in ${relative}`, () => {
      const source = readFileSync(path.join(ROOT, relative), "utf8");
      const hits = FORBIDDEN_LITERALS.filter((literal) => source.includes(literal));
      expect(hits, `unexpected literals: ${hits.join(", ")}`).toEqual([]);
    });
  }
});
