import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { STAFF_UI_COPY, type StaffUiCopyKey } from "@/lib/staff/locale";

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
  "app/tenants/[tenantId]/catalogue/products/product-modifier-assignment-policy-editor.tsx",
  "app/tenants/[tenantId]/catalogue/products/product-new-screen.tsx",
  "app/tenants/[tenantId]/catalogue/products/new/page.tsx",
  "components/portal/workspace/PortalWorkspace.tsx",
  "app/tenants/[tenantId]/catalogue/menus/menu-management.tsx",
  "app/tenants/[tenantId]/catalogue/menus/menu-editor-screen.tsx",
  "app/tenants/[tenantId]/catalogue/menus/menu-publish-panel.tsx",
  "app/tenants/[tenantId]/catalogue/menus/menu-health-panel.tsx",
  "app/tenants/[tenantId]/catalogue/menus/menu-manager-section.tsx",
  "app/tenants/[tenantId]/catalogue/menus/ai-photo-generator.tsx",
  "app/tenants/[tenantId]/catalogue/menus/page.tsx",
  "app/tenants/[tenantId]/catalogue/menus/new/page.tsx",
  "app/tenants/[tenantId]/catalogue/menus/[menuPublicId]/edit/page.tsx",
  "app/tenants/[tenantId]/catalogue/menus/menu-manager-view.ts",
  "app/tenants/[tenantId]/catalogue/menus/ai-photo-view.ts",
  // QOS-192 branch context and Phase 2 entry pages
  "components/staff/branch-change-guard.tsx",
  "components/staff/phase2-entry-screen.tsx",
  "app/tenants/[tenantId]/settings/branches/page.tsx",
  "app/tenants/[tenantId]/settings/branches/branches-settings-screen.tsx",
  "app/tenants/[tenantId]/inventory/page.tsx",
  "app/tenants/[tenantId]/kitchen/page.tsx",
  "app/tenants/[tenantId]/sales/page.tsx",
  "app/tenants/[tenantId]/reports/page.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/page.tsx",
  // QOS-193 catalogue import landing: current profile and QOS workbook
  "app/tenants/[tenantId]/catalogue/import/page.tsx",
  "app/tenants/[tenantId]/catalogue/import/catalogue-import-panel.tsx",
  "app/tenants/[tenantId]/catalogue/import/workbook-import-panel.tsx",
  // QOS-216 Foodics menu workbook recognition and conversion result
  "app/tenants/[tenantId]/catalogue/import/foodics-menu-result.tsx",
  // QOS-194 workbook review panel and row
  "app/tenants/[tenantId]/catalogue/import/workbook-review-panel.tsx",
  "app/tenants/[tenantId]/catalogue/import/workbook-review-row.tsx",
  // QOS-217 workbook apply section
  "app/tenants/[tenantId]/catalogue/import/workbook-apply-panel.tsx",
  // QOS-213 sales-channel price grid in the variant and modifier-option editors
  "components/staff/catalogue/channel-price-grid.tsx",
  "components/staff/catalogue/channel-price-state.ts",
  "components/staff/catalogue/use-channel-price-bundle.ts",
  // QOS-214 selling attributes and supplied nutrition fields
  "app/tenants/[tenantId]/catalogue/products/selling-attributes-fields.tsx",
  // Modifier group editor: delete block (rest of the editor is not yet localised)
  "app/tenants/[tenantId]/catalogue/modifier-groups/modifier-group-editor.tsx",
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
  "app/tenants/[tenantId]/catalogue/products/product-modifier-assignment-policy-editor.tsx",
  "app/tenants/[tenantId]/catalogue/products/product-removed-photo-history.tsx",
  "app/tenants/[tenantId]/catalogue/products/ai-description-review.tsx",
  "app/tenants/[tenantId]/catalogue/menus/menu-editor.tsx",
  "app/tenants/[tenantId]/catalogue/menus/menu-management.tsx",
  "app/tenants/[tenantId]/catalogue/menus/menu-editor-screen.tsx",
  "app/tenants/[tenantId]/catalogue/menus/menu-publish-panel.tsx",
  "app/tenants/[tenantId]/catalogue/menus/menu-health-panel.tsx",
  "app/tenants/[tenantId]/catalogue/menus/menu-manager-section.tsx",
  "app/tenants/[tenantId]/catalogue/menus/ai-photo-generator.tsx",
  "app/tenants/[tenantId]/catalogue/menus/page.tsx",
  "app/tenants/[tenantId]/catalogue/menus/new/page.tsx",
  "app/tenants/[tenantId]/catalogue/menus/[menuPublicId]/edit/page.tsx",
  // QOS-192 branch context and Phase 2 entry pages
  "components/staff/branch-change-guard.tsx",
  "components/staff/phase2-entry-screen.tsx",
  "app/tenants/[tenantId]/settings/branches/page.tsx",
  "app/tenants/[tenantId]/settings/branches/branches-settings-screen.tsx",
  "app/tenants/[tenantId]/inventory/page.tsx",
  "app/tenants/[tenantId]/kitchen/page.tsx",
  "app/tenants/[tenantId]/sales/page.tsx",
  "app/tenants/[tenantId]/reports/page.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/page.tsx",
  // QOS-193 catalogue import landing: current profile and QOS workbook
  "app/tenants/[tenantId]/catalogue/import/page.tsx",
  "app/tenants/[tenantId]/catalogue/import/catalogue-import-panel.tsx",
  "app/tenants/[tenantId]/catalogue/import/workbook-import-panel.tsx",
  // QOS-216 Foodics menu workbook recognition and conversion result
  "app/tenants/[tenantId]/catalogue/import/foodics-menu-result.tsx",
  // QOS-194 workbook review panel and row
  "app/tenants/[tenantId]/catalogue/import/workbook-review-panel.tsx",
  "app/tenants/[tenantId]/catalogue/import/workbook-review-row.tsx",
  // QOS-217 workbook apply section
  "app/tenants/[tenantId]/catalogue/import/workbook-apply-panel.tsx",
  // QOS-213 sales-channel price grid in the variant and modifier-option editors
  "components/staff/catalogue/channel-price-grid.tsx",
  "components/staff/catalogue/channel-price-state.ts",
  "components/staff/catalogue/use-channel-price-bundle.ts",
  "app/tenants/[tenantId]/catalogue/products/selling-attributes-fields.tsx",
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
  '"Menu completeness"',
  '>Publish draft<',
  '"Save draft"',
  '"Ask QOS to review this menu"',
  '"Select items to generate"',
  'kind: "System fact"',
  '>Generate with AI, then review before use<',
  '"All branches"',
  ">All branches<",
  '"Switch branch"',
  ">Stay<",
  '"Stay"',
  ">Save draft<",
  '"Not yet mapped"',
  ">Not yet mapped<",
  '"This area is not available yet"',
  '"Loading branches…"',
  '"Your permitted locations"',
  // QOS-192 narrow top bar: business switch trigger and listbox
  '"Switch business"',
  ">Switch business<",
  '"Business: ',
  // QOS-193 catalogue import landing
  ">Catalogue import<",
  ">Preview import<",
  ">Apply validated rows<",
  ">Download sample CSV<",
  ">Download sample XLSX<",
  ">Download blank template<",
  ">Export current records<",
  ">Select column<",
  '"Preview failed."',
  '"Apply failed."',
  // QOS-216 Foodics menu result
  ">Download QOS workbook<",
  ">Source workbook recognised<",
  ">Required mappings<",
  ">Sheets not read<",
  // QOS-212 product modifier policy editor
  ">Edit rules<",
  ">Save rules<",
  ">Reset to group defaults<",
  '"Rules for this product"',
  '"Group default"',
  '"Product override"',
  "up to {",
  // QOS-194 workbook review
  ">Review against QOS records<",
  ">Re-run review with decisions<",
  ">Download correction report<",
  '"Needs decision"',
  ">Match existing<",
  // QOS-213 channel prices
  '"Sales channel prices"',
  ">Save price<",
  ">Use base price<",
  ">Add channel<",
  '"Uses base price"',
  '"Channel list"',
  // QOS-214 selling attributes
  ">Preparation time (minutes)<",
  ">High in salt<",
  ">Sold as a stock product<",
  ">Selling basis<",
  ">Price unit<",
  ">Not declared<",
  ">Unknown<",
  '"Calories (optional)"',
  // Modifier group delete
  '"Delete this modifier group?"',
  '"Unable to delete modifier group."',
  ">Delete<",
];

/* Every QOS-214 key has English and Arabic copy, and the Arabic is Arabic. */
const QOS_214_COPY_KEYS = [
  "productEditorSectionSellingTitle",
  "productEditorSectionSellingHelp",
  "productEditorPrepTimeLabel",
  "productEditorPrepTimeHelp",
  "productEditorWalkingTimeLabel",
  "productEditorWalkingTimeHelp",
  "productEditorHighSaltLabel",
  "productEditorTriStateUnknown",
  "productEditorTriStateYes",
  "productEditorTriStateNo",
  "productEditorStockIntentLabel",
  "productEditorStockIntentHelp",
  "productEditorStockIntentUnresolved",
  "productEditorInvalidMinutes",
  "variantSellingBasisLabel",
  "variantSellingBasisUndeclared",
  "variantSellingBasisEach",
  "variantSellingBasisWeight",
  "variantPriceUnitLabel",
  "variantPriceUnitEach",
  "variantPriceUnitKg",
  "variantPriceUnitG",
  "variantPriceUnitQuantityLabel",
  "variantPriceUnitQuantityHelp",
  "variantPriceUnitQuantityInvalid",
  "variantWeightUnresolved",
  "variantSellingBasisNote",
  "modifierOptionCaloriesLabel",
  "modifierOptionCaloriesHelp",
  "modifierOptionCaloriesInvalid",
] as const satisfies readonly StaffUiCopyKey[];

describe("QOS-214 staff copy", () => {
  it.each(QOS_214_COPY_KEYS)("%s has English and Arabic text", (key) => {
    const en = STAFF_UI_COPY.en[key];
    const ar = STAFF_UI_COPY.ar[key];
    expect(en.trim().length).toBeGreaterThan(0);
    expect(ar).toMatch(/[\u0600-\u06FF]/);
    expect(ar).not.toBe(en);
    // No shouted copy.
    expect(en).not.toMatch(/\b[A-Z]{4,}\b/);
  });

  it("modifier option editor reads its new copy from STAFF_UI_COPY", () => {
    const source = readFileSync(
      path.join(ROOT, "app/tenants/[tenantId]/catalogue/modifier-groups/modifier-group-editor.tsx"),
      "utf8",
    );
    expect(source).toContain('staffUiCopy(locale, "modifierOptionCaloriesLabel")');
    expect(source).not.toContain('"Calories (optional)"');
  });
});

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
