import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(process.cwd(), "src");

const AUDITED_SURFACES = [
  "app/tenants/[tenantId]/channels/online-store/page.tsx",
  "app/tenants/[tenantId]/channels/online-store/online-store-management.tsx",
  "app/tenants/[tenantId]/channels/online-store/storefront-overview-card.tsx",
  "app/tenants/[tenantId]/channels/online-store/storefront-publish-panel.tsx",
  "app/tenants/[tenantId]/channels/online-store/storefront-theme-panel.tsx",
  "app/tenants/[tenantId]/channels/online-store/storefront-content-blocks-panel.tsx",
  "app/tenants/[tenantId]/channels/online-store/storefront-view.ts",
  "components/platform/catalogue-products-list.tsx",
  "components/portal/PortalTopBar.tsx",
  "components/staff/StaffAppShell.tsx",
  "app/tenants/[tenantId]/catalogue/products/product-editor.tsx",
  "app/tenants/[tenantId]/catalogue/products/product-edit-screen.tsx",
  "app/tenants/[tenantId]/catalogue/menus/menu-editor.tsx",
  "app/tenants/[tenantId]/catalogue/products/product-variants-panel.tsx",
  "app/tenants/[tenantId]/catalogue/products/product-modifier-groups-panel.tsx",
  "app/tenants/[tenantId]/catalogue/products/product-new-screen.tsx",
  "app/tenants/[tenantId]/catalogue/products/new/page.tsx",
  "components/portal/workspace/PortalWorkspace.tsx",
];

const PORTAL_RESTYLED_SURFACES = [
  "app/tenants/[tenantId]/channels/online-store/page.tsx",
  "app/tenants/[tenantId]/channels/online-store/online-store-management.tsx",
  "app/tenants/[tenantId]/channels/online-store/storefront-overview-card.tsx",
  "app/tenants/[tenantId]/channels/online-store/storefront-publish-panel.tsx",
  "app/tenants/[tenantId]/channels/online-store/storefront-theme-panel.tsx",
  "app/tenants/[tenantId]/channels/online-store/storefront-content-blocks-panel.tsx",
  "app/tenants/[tenantId]/channels/online-store/storefront-view.ts",
  "components/platform/catalogue-products-list.tsx",
  "components/portal/workspace/PortalWorkspace.tsx",
  "app/tenants/[tenantId]/catalogue/page.tsx",
  "app/tenants/[tenantId]/catalogue/products/product-editor.tsx",
  "app/tenants/[tenantId]/catalogue/products/product-edit-screen.tsx",
  "app/tenants/[tenantId]/catalogue/products/product-new-screen.tsx",
  "app/tenants/[tenantId]/catalogue/products/product-editor-section.tsx",
  "app/tenants/[tenantId]/catalogue/products/product-variants-panel.tsx",
  "app/tenants/[tenantId]/catalogue/products/product-modifier-groups-panel.tsx",
  "app/tenants/[tenantId]/catalogue/products/product-removed-photo-history.tsx",
  "app/tenants/[tenantId]/catalogue/products/ai-description-review.tsx",
];

// Light-theme palette utilities render dark-grey or white-on-white on the portal's navy glass.
const LIGHT_PALETTE_CLASS =
  /\b(?:text|bg|border|ring|divide|placeholder)-(?:white|black|(?:zinc|gray|slate|neutral|stone|emerald|rose|amber|red|green)-\d{2,3})\b/g;

const FORBIDDEN_LITERALS = [
  'title="Online Store"',
  '"Unable to load storefronts."',
  '"Unable to load release history."',
  '"Theme draft saved. Publish to update the live storefront."',
  '"Unable to load content blocks."',
  '`Release v${',
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
  '"General information"',
  '"English copy"',
  '"Arabic copy"',
  '"Internal name"',
  '"Unsaved changes"',
  '"Remove this photo?"',
  '"Removed photos"',
  '"Sellable variants"',
  ">Reload<",
  '"Variant saved."',
  ">Save variant<",
  ">Make default<",
  ">Move up<",
  ">Move down<",
  ">Add variant<",
  '"English label"',
  '"Arabic label"',
  ">Manage groups<",
  ">Detach<",
  ">Attach<",
  '"Select a modifier group"',
  "option(s)",
  '"New draft product"',
  '"Catalogue management"',
  '"No file chosen"',
  '"Previous page"',
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

describe("portal restyled surfaces", () => {
  for (const relative of PORTAL_RESTYLED_SURFACES) {
    it(`use portal tokens instead of light palette classes in ${relative}`, () => {
      const source = readFileSync(path.join(ROOT, relative), "utf8");
      const hits = [...new Set(source.match(LIGHT_PALETTE_CLASS) ?? [])];
      expect(hits, `light palette classes: ${hits.join(", ")}`).toEqual([]);
    });
  }
});
