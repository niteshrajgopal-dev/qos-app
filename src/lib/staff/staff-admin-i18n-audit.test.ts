import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(process.cwd(), "src");

const AUDITED_SURFACES = [
  "components/platform/catalogue-products-list.tsx",
  "components/portal/PortalTopBar.tsx",
  "components/staff/StaffAppShell.tsx",
  "app/tenants/[tenantId]/catalogue/products/product-editor.tsx",
  "app/tenants/[tenantId]/catalogue/menus/menu-editor.tsx",
];

const FORBIDDEN_LITERALS = [
  '"Cancel"',
  '"Confirm"',
  '"Keep editing"',
  '"Discard"',
  'title="Products"',
  '"New product"',
  '"Clear search"',
  '"Restore to draft"',
  ">More<",
  ">Overview<",
  '"Sign out"',
  "readStoredStaffLocale(",
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
