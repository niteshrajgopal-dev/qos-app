import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { STAFF_COUNT_COPY, STAFF_UI_COPY, staffCount, type StaffUiCopyKey } from "@/lib/staff/locale";

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
  "app/tenants/[tenantId]/catalogue/products/product-variants-panel-state.ts",
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
  // QOS-200 sheets kept for later (prep targets, opening stock, provider mappings, combos)
  "app/tenants/[tenantId]/catalogue/import/workbook-pending-sheets.tsx",
  // QOS-200 follow-up: past imports on the import page
  "app/tenants/[tenantId]/catalogue/import/workbook-import-history.tsx",
  // QOS-213 sales-channel price grid in the variant and modifier-option editors
  "components/staff/catalogue/channel-price-grid.tsx",
  "components/staff/catalogue/channel-price-state.ts",
  "components/staff/catalogue/use-channel-price-bundle.ts",
  // QOS-214 selling attributes and supplied nutrition fields
  "app/tenants/[tenantId]/catalogue/products/selling-attributes-fields.tsx",
  // Modifier group editor: delete block (rest of the editor is not yet localised)
  "app/tenants/[tenantId]/catalogue/modifier-groups/modifier-group-editor.tsx",
  // QOS-215 selling tax and reference cost fields
  "app/tenants/[tenantId]/catalogue/products/sellable-tax-cost-fields.tsx",  // QOS-195 inventory units, items and item conversions
  "app/tenants/[tenantId]/inventory/inventory-screen.tsx",
  "app/tenants/[tenantId]/inventory/inventory-client.ts",
  "app/tenants/[tenantId]/inventory/unit-editor.tsx",
  "app/tenants/[tenantId]/inventory/item-editor.tsx",
  "app/tenants/[tenantId]/inventory/item-conversions-panel.tsx",
  "app/tenants/[tenantId]/inventory/conversion-preview-panel.tsx",
  "app/tenants/[tenantId]/inventory/units/new/page.tsx",
  "app/tenants/[tenantId]/inventory/units/[unitPublicId]/edit/page.tsx",
  "app/tenants/[tenantId]/inventory/items/new/page.tsx",
  "app/tenants/[tenantId]/inventory/items/[itemPublicId]/page.tsx",
  // QOS-196 suppliers and branch warehouses
  "app/tenants/[tenantId]/inventory/supplier-editor.tsx",
  "app/tenants/[tenantId]/inventory/warehouse-editor.tsx",
  "app/tenants/[tenantId]/inventory/dependency-notice.tsx",
  "app/tenants/[tenantId]/inventory/suppliers/new/page.tsx",
  "app/tenants/[tenantId]/inventory/suppliers/[supplierPublicId]/page.tsx",
  "app/tenants/[tenantId]/inventory/warehouses/new/page.tsx",
  "app/tenants/[tenantId]/inventory/warehouses/[warehousePublicId]/page.tsx",
  // QOS-197 inventory categories, item filters and reference costs
  "app/tenants/[tenantId]/inventory/category-editor.tsx",
  "app/tenants/[tenantId]/inventory/item-cost-panel.tsx",
  "app/tenants/[tenantId]/inventory/inventory-filters.ts",
  "app/tenants/[tenantId]/inventory/categories/new/page.tsx",
  "app/tenants/[tenantId]/inventory/categories/[categoryPublicId]/page.tsx",
  // QOS-198 recipes, versions, steps and sellable links
  "app/tenants/[tenantId]/catalogue/recipes/recipes-screen.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/recipes-client.ts",
  "app/tenants/[tenantId]/catalogue/recipes/recipe-states.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/recipe-editor.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/recipe-versions-panel.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/recipe-lines-panel.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/recipe-steps-panel.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/recipe-links-panel.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/recipe-version-screen.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/sellable-links-tab.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/link-dialog.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/consumption-preview-panel.tsx",
  // QOS-199 modifier effects panel
  "app/tenants/[tenantId]/catalogue/recipes/recipe-effects-panel.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/new/page.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/[recipePublicId]/page.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/[recipePublicId]/versions/[versionPublicId]/page.tsx",
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
  // QOS-200 sheets kept for later (prep targets, opening stock, provider mappings, combos)
  "app/tenants/[tenantId]/catalogue/import/workbook-pending-sheets.tsx",
  // QOS-200 follow-up: past imports on the import page
  "app/tenants/[tenantId]/catalogue/import/workbook-import-history.tsx",
  // QOS-213 sales-channel price grid in the variant and modifier-option editors
  "components/staff/catalogue/channel-price-grid.tsx",
  "components/staff/catalogue/channel-price-state.ts",
  "components/staff/catalogue/use-channel-price-bundle.ts",
  "app/tenants/[tenantId]/catalogue/products/selling-attributes-fields.tsx",
  "app/tenants/[tenantId]/catalogue/products/sellable-tax-cost-fields.tsx",  // QOS-195 inventory units, items and item conversions
  "app/tenants/[tenantId]/inventory/inventory-screen.tsx",
  "app/tenants/[tenantId]/inventory/inventory-client.ts",
  "app/tenants/[tenantId]/inventory/unit-editor.tsx",
  "app/tenants/[tenantId]/inventory/item-editor.tsx",
  "app/tenants/[tenantId]/inventory/item-conversions-panel.tsx",
  "app/tenants/[tenantId]/inventory/conversion-preview-panel.tsx",
  "app/tenants/[tenantId]/inventory/units/new/page.tsx",
  "app/tenants/[tenantId]/inventory/units/[unitPublicId]/edit/page.tsx",
  "app/tenants/[tenantId]/inventory/items/new/page.tsx",
  "app/tenants/[tenantId]/inventory/items/[itemPublicId]/page.tsx",
  // QOS-196 suppliers and branch warehouses
  "app/tenants/[tenantId]/inventory/supplier-editor.tsx",
  "app/tenants/[tenantId]/inventory/warehouse-editor.tsx",
  "app/tenants/[tenantId]/inventory/dependency-notice.tsx",
  "app/tenants/[tenantId]/inventory/suppliers/new/page.tsx",
  "app/tenants/[tenantId]/inventory/suppliers/[supplierPublicId]/page.tsx",
  "app/tenants/[tenantId]/inventory/warehouses/new/page.tsx",
  "app/tenants/[tenantId]/inventory/warehouses/[warehousePublicId]/page.tsx",
  // QOS-197 inventory categories, item filters and reference costs
  "app/tenants/[tenantId]/inventory/category-editor.tsx",
  "app/tenants/[tenantId]/inventory/item-cost-panel.tsx",
  "app/tenants/[tenantId]/inventory/inventory-filters.ts",
  "app/tenants/[tenantId]/inventory/categories/new/page.tsx",
  "app/tenants/[tenantId]/inventory/categories/[categoryPublicId]/page.tsx",
  // QOS-198 recipes, versions, steps and sellable links
  "app/tenants/[tenantId]/catalogue/recipes/recipes-screen.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/recipes-client.ts",
  "app/tenants/[tenantId]/catalogue/recipes/recipe-states.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/recipe-editor.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/recipe-versions-panel.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/recipe-lines-panel.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/recipe-steps-panel.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/recipe-links-panel.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/recipe-version-screen.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/sellable-links-tab.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/link-dialog.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/consumption-preview-panel.tsx",
  // QOS-199 modifier effects panel
  "app/tenants/[tenantId]/catalogue/recipes/recipe-effects-panel.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/new/page.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/[recipePublicId]/page.tsx",
  "app/tenants/[tenantId]/catalogue/recipes/[recipePublicId]/versions/[versionPublicId]/page.tsx",
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
  // QOS-215 selling tax and reference cost
  ">Save tax<",
  ">Save manual cost<",
  ">Use recipe-derived cost<",
  ">Clear cost policy<",
  '"Reference cost"',
  '"Reference margin"',
  '"Price tax basis"',
  '"Tax rate"',
  '"No cost policy"',
  // QOS-195 inventory units, items and conversions
  ">Add item<",
  ">Add custom unit<",
  ">Add standard unit<",
  ">Save unit<",
  ">Save item<",
  ">Change factor<",
  ">End this rule<",
  ">Add conversion<",
  '"Conversions for this item"',
  '"How quantities convert"',
  '"Storage unit"',
  '"Not set"',
  // QOS-196 suppliers and branch warehouses
  ">Add supplier<",
  ">Add warehouse<",
  ">Save supplier<",
  ">Save warehouse<",
  '"Default supplier"',
  '"Reference code (optional)"',
  '"Contact name"',
  '"Warehouses"',
  '"Suppliers"',
  // QOS-197 inventory categories, item filters and reference costs
  ">Add category<",
  ">Save category<",
  ">Save cost<",
  ">Clear cost<",
  '"Reference cost"',
  '"Cost unknown"',
  '"No category"',
  '"Categories"',
  '"Search items"',
  '"Tax basis"',
  // QOS-198 recipes and sellable links
  ">Add recipe<",
  ">Save recipe<",
  ">Approve version<",
  ">Discard draft<",
  ">Create draft from this version<",
  ">Add line<",
  ">Add step<",
  ">Save lines<",
  ">Save steps<",
  ">Link recipe<",
  ">Link stock item<",
  ">Replace link<",
  ">End link<",
  ">Preview usage<",
  '"Ingredient lines"',
  '"Preparation steps"',
  '"Sellable links"',
  '"Version history"',
  '"Not in the workbook template"',
  // QOS-199 modifier effects, cost and margin preview
  ">Add effect<",
  ">Save effects<",
  ">Remove effect<",
  '"Modifier effects"',
  '"Ingredient margin"',
  '"Ingredient cost"',
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

describe("QOS-215 selling tax and reference cost copy", () => {
  const keys = Object.keys(STAFF_UI_COPY.en).filter((key) => key.startsWith("sellable")) as Array<
    keyof (typeof STAFF_UI_COPY)["en"]
  >;
  const sources = [
    "app/tenants/[tenantId]/catalogue/products/sellable-tax-cost-fields.tsx",
    "app/tenants/[tenantId]/catalogue/products/product-variants-panel.tsx",
    "app/tenants/[tenantId]/catalogue/modifier-groups/modifier-group-editor.tsx",
  ]
    .map((relative) => readFileSync(path.join(ROOT, relative), "utf8"))
    .join("\n");

  it("has English and Arabic text for every key, Arabic in Arabic script", () => {
    expect(keys.length).toBeGreaterThan(50);
    for (const key of keys) {
      const en = STAFF_UI_COPY.en[key];
      const ar = STAFF_UI_COPY.ar[key];
      expect(en.trim(), key).not.toBe("");
      expect(ar.trim(), key).not.toBe("");
      expect(ar, key).not.toBe(en);
      expect(ar, key).toMatch(/[\u0600-\u06FF]/);
    }
  });

  it("uses no all-caps English copy", () => {
    for (const key of keys) {
      const letters = STAFF_UI_COPY.en[key].replace(/\{\w+\}|QOS/g, "").replace(/[^A-Za-z]/g, "");
      expect(letters.length === 0 || letters !== letters.toUpperCase(), key).toBe(true);
    }
  });

  it("references every key from the surfaces that render it", () => {
    const unused = keys.filter((key) => !sources.includes(`"${key}"`));
    expect(unused).toEqual([]);
  });
});

/* QOS-195: every inventory key has English and Arabic copy, the Arabic is
   Arabic with no English words left in it, nothing is shouted, and every key
   is rendered by the inventory surfaces. Unit codes are data, not copy. */
const QOS_195_COPY_KEYS = [
  "inventoryTabsLabel",
  "inventoryItemsTab",
  "inventoryUnitsTab",
  "inventoryMasterDataNote",
  "inventoryReadOnlyNote",
  "inventoryLoading",
  "inventoryItemsEmpty",
  "inventoryUnitsEmpty",
  "inventoryBack",
  "inventoryStatusActive",
  "inventoryStatusArchived",
  "addItem",
  "addStandardUnit",
  "addCustomUnit",
  "openItem",
  "editUnit",
  "newItemTitle",
  "standardUnitPicker",
  "standardUnitHelp",
  "customUnitHelp",
  "allStandardUnitsAdded",
  "selectUnit",
  "unitCode",
  "unitCodeHelp",
  "unitNameEn",
  "unitNameAr",
  "quantityKind",
  "quantityKindMass",
  "quantityKindVolume",
  "quantityKindCount",
  "quantityKindPack",
  "decimalPlaces",
  "decimalPlacesHelp",
  "standardUnitBadge",
  "customUnitBadge",
  "unitCodeImmutable",
  "unitUsage",
  "saveUnit",
  "unitSaved",
  "archiveUnit",
  "restoreUnit",
  "archiveUnitConfirm",
  "unitInUse",
  "unitArchivedNote",
  "itemNameEn",
  "itemNameAr",
  "itemKind",
  "itemKindPurchased",
  "itemKindPrepared",
  "storageUnit",
  "recipeUnit",
  "purchaseUnit",
  "unitNotSet",
  "saveItem",
  "itemSaved",
  "archiveItem",
  "restoreItem",
  "archiveItemConfirm",
  "itemArchivedNote",
  "conversionsTitle",
  "conversionsHelp",
  "conversionsEmpty",
  "conversionRule",
  "conversionEffectiveFrom",
  "conversionEffectiveTo",
  "conversionRevision",
  "conversionCurrent",
  "conversionJustificationLine",
  "conversionSaved",
  "addConversion",
  "fromUnit",
  "toUnit",
  "factor",
  "factorHelp",
  "justification",
  "justificationHelp",
  "effectiveFrom",
  "closeConversionDate",
  "reviseConversion",
  "reviseConversionHelp",
  "saveConversionVersion",
  "closeConversion",
  "closeConversionConfirm",
  "conversionHistory",
  "conversionHistoryHelp",
  "conversionPreviewTitle",
  "previewStorageRecipe",
  "previewPurchaseStorage",
  "previewPurchaseRecipe",
  "previewLine",
  "previewRounded",
  "previewReceiptExample",
  "previewRecipeExample",
  "previewPathLabel",
  "previewViaStandard",
  "previewViaRule",
  "previewMissingNoRule",
  "previewMissingMassVolume",
  "previewMissingPack",
  "previewMissingDesignation",
  "previewMissingArchived",
  "previewComplete",
  "previewIncomplete",
  "inventoryLoadError",
  "inventorySaveError",
  "versionConflict",
] as const satisfies readonly StaffUiCopyKey[];

describe("QOS-195 inventory copy", () => {
  const sources = [
    "app/tenants/[tenantId]/inventory/inventory-screen.tsx",
    "app/tenants/[tenantId]/inventory/inventory-client.ts",
    "app/tenants/[tenantId]/inventory/unit-editor.tsx",
    "app/tenants/[tenantId]/inventory/item-editor.tsx",
    "app/tenants/[tenantId]/inventory/item-conversions-panel.tsx",
    "app/tenants/[tenantId]/inventory/conversion-preview-panel.tsx",
    "lib/inventory/conversion-preview.ts",
  ]
    .map((relative) => readFileSync(path.join(ROOT, relative), "utf8"))
    .join("\n");

  it.each(QOS_195_COPY_KEYS)("%s has English and Arabic text with no English left in Arabic", (key) => {
    const en = STAFF_UI_COPY.en[key];
    const ar = STAFF_UI_COPY.ar[key];
    expect(en.trim().length).toBeGreaterThan(0);
    expect(ar).toMatch(/[\u0600-\u06FF]|^1 \{from\} = \{factor\} \{to\}$/);
    expect(ar.replace(/\{\w+\}/g, "")).not.toMatch(/[A-Za-z]/);
    const letters = en.replace(/\{\w+\}/g, "").replace(/[^A-Za-z]/g, "");
    expect(letters === "" || letters !== letters.toUpperCase()).toBe(true);
  });

  it("keeps the inventory notice free of ticket IDs and English in Arabic", () => {
    const en = STAFF_UI_COPY.en.inventoryEmptyBody;
    const ar = STAFF_UI_COPY.ar.inventoryEmptyBody;
    expect(en).toBe("Stock levels are not available yet.");
    for (const text of [en, ar]) expect(text).not.toMatch(/QOS|\d/);
    expect(ar).toMatch(/[\u0600-\u06FF]/);
    expect(ar).not.toMatch(/[A-Za-z]/);
  });

  it("references every key from the inventory surfaces", () => {
    const unused = QOS_195_COPY_KEYS.filter((key) => !sources.includes(`"${key}"`));
    expect(unused).toEqual([]);
  });

  it("has Arabic plural forms for the inventory counts", () => {
    for (const key of ["inventoryItems", "inventoryUnits", "conversionRules", "conversionVersions"] as const) {
      const forms = STAFF_COUNT_COPY.ar[key];
      expect(Object.keys(forms).sort(), key).toEqual(["few", "many", "one", "other", "two", "zero"]);
      for (const text of Object.values(forms)) {
        expect(text, key).toMatch(/[\u0600-\u06FF]/);
        expect(text.replace("{count}", ""), key).not.toMatch(/[A-Za-z]/);
      }
    }
    expect(staffCount("ar", "inventoryUnits", 2)).toBe("وحدتان");
    expect(staffCount("ar", "conversionVersions", 11)).toBe("11 إصدارًا");
    expect(staffCount("en", "conversionRules", 1)).toBe("1 current rule");
  });

  it("keeps the inventory surfaces free of all-caps styling", () => {
    expect(sources).not.toMatch(/uppercase/i);
  });
});

/* QOS-196: supplier and warehouse copy follows the QOS-195 rules: English and
   Arabic present, no English left in the Arabic (supplier and warehouse
   names, codes, phones and emails are data, not copy), nothing shouted, no
   ticket ids, and every key rendered by the new surfaces. */
const QOS_196_COPY_KEYS = [
  "inventorySuppliersTab",
  "inventoryWarehousesTab",
  "inventorySuppliersEmpty",
  "inventoryWarehousesEmpty",
  "addSupplier",
  "addWarehouse",
  "openSupplier",
  "openWarehouse",
  "newSupplierTitle",
  "newWarehouseTitle",
  "supplierCode",
  "supplierCodeHelp",
  "supplierContactName",
  "supplierPhone",
  "supplierEmail",
  "supplierAddress",
  "inventoryNotes",
  "supplierContactHelp",
  "supplierDuplicateNameNote",
  "saveSupplier",
  "supplierSaved",
  "archiveSupplier",
  "restoreSupplier",
  "archiveSupplierConfirm",
  "supplierArchivedNote",
  "supplierItemsTitle",
  "supplierItemsHelp",
  "supplierItemsEmpty",
  "supplierReceiptsUnavailable",
  "defaultSupplier",
  "defaultSupplierHelp",
  "warehouseBranch",
  "warehouseBranchHelp",
  "warehouseCode",
  "warehouseCodeHelp",
  "warehouseBranchFixedNote",
  "warehouseBranchSuspendedNote",
  "warehouseNoBranchAvailable",
  "warehouseNoHistory",
  "saveWarehouse",
  "warehouseSaved",
  "archiveWarehouse",
  "restoreWarehouse",
  "archiveWarehouseConfirm",
  "warehouseArchivedNote",
  "inventoryDependenciesTitle",
  "inventoryMasterDataNote",
  "inventoryReadOnlyNote",
  "inventoryEmptyBody",
] as const satisfies readonly StaffUiCopyKey[];

describe("QOS-196 supplier and warehouse copy", () => {
  const sources = [
    "app/tenants/[tenantId]/inventory/inventory-screen.tsx",
    "app/tenants/[tenantId]/inventory/item-editor.tsx",
    "app/tenants/[tenantId]/inventory/supplier-editor.tsx",
    "app/tenants/[tenantId]/inventory/warehouse-editor.tsx",
    "app/tenants/[tenantId]/inventory/dependency-notice.tsx",
  ]
    .map((relative) => readFileSync(path.join(ROOT, relative), "utf8"))
    .join("\n");

  it.each(QOS_196_COPY_KEYS)("%s has English and Arabic text with no English, ticket ids or shouting", (key) => {
    const en = STAFF_UI_COPY.en[key];
    const ar = STAFF_UI_COPY.ar[key];
    expect(en.trim().length).toBeGreaterThan(0);
    expect(ar).toMatch(/[\u0600-\u06FF]/);
    expect(ar.replace(/\{\w+\}/g, "")).not.toMatch(/[A-Za-z]/);
    for (const text of [en, ar]) expect(text).not.toMatch(/QOS-\d|[A-Z]{2,}-\d/);
    const letters = en.replace(/\{\w+\}/g, "").replace(/[^A-Za-z]/g, "");
    expect(letters !== letters.toUpperCase()).toBe(true);
    // Sentence case: only the first word starts with a capital letter, except after a full stop.
    const words = en.replace(/\{\w+\}/g, "").split(/\s+/).filter(Boolean);
    words.forEach((word, index) => {
      const sentenceStart = index === 0 || /[.?]$/.test(words[index - 1]!);
      if (!sentenceStart && word !== "All") expect(word, `${key}: ${en}`).not.toMatch(/^[A-Z]/);
    });
  });

  it("references every key from the supplier and warehouse surfaces", () => {
    const unused = QOS_196_COPY_KEYS.filter((key) => !sources.includes(`"${key}"`));
    expect(unused).toEqual([]);
  });

  it("has Arabic plural forms for the supplier and warehouse counts", () => {
    for (const key of ["inventorySuppliers", "inventoryWarehouses", "supplierItems"] as const) {
      const forms = STAFF_COUNT_COPY.ar[key];
      expect(Object.keys(forms).sort(), key).toEqual(["few", "many", "one", "other", "two", "zero"]);
      for (const text of Object.values(forms)) {
        expect(text, key).toMatch(/[\u0600-\u06FF]/);
        expect(text.replace("{count}", ""), key).not.toMatch(/[A-Za-z]/);
      }
    }
    expect(staffCount("ar", "inventorySuppliers", 2)).toBe("مورّدان");
    expect(staffCount("ar", "inventoryWarehouses", 3)).toBe("3 مستودعات");
    expect(staffCount("ar", "supplierItems", 11)).toBe("11 صنفًا يستخدم هذا المورّد");
    expect(staffCount("en", "supplierItems", 1)).toBe("1 item uses this supplier");
    expect(staffCount("en", "inventoryWarehouses", 2)).toBe("2 warehouses");
  });

  it("keeps the supplier and warehouse surfaces free of all-caps styling", () => {
    expect(sources).not.toMatch(/uppercase/i);
  });
});

/* QOS-197: category, filter and reference cost copy follows the QOS-196
   rules: English and Arabic present, no English left in the Arabic (item and
   category names, codes and amounts are data, not copy), nothing shouted, no
   ticket ids, sentence case, and every key rendered by the new surfaces. The
   inventory notice now names only what is still missing: stock levels. */
const QOS_197_COPY_KEYS = [
  "inventoryCategoriesTab",
  "inventoryCategoriesEmpty",
  "addCategory",
  "openCategory",
  "newCategoryTitle",
  "categoryHelp",
  "saveCategory",
  "categorySaved",
  "archiveCategory",
  "restoreCategory",
  "archiveCategoryConfirm",
  "categoryArchivedNote",
  "categoryItemsTitle",
  "categoryItemsHelp",
  "categoryItemsEmpty",
  "itemCategory",
  "itemCategoryNone",
  "itemNotesHelp",
  "itemKindHelp",
  "inventoryFilterSearch",
  "inventoryFilterSearchPlaceholder",
  "inventoryFilterKind",
  "inventoryFilterStatus",
  "inventoryFilterAll",
  "inventoryFilterCost",
  "inventoryFilterNoMatch",
  "inventoryItemsShown",
  "costPanelTitle",
  "costPanelHelp",
  "costUnknown",
  "costKnown",
  "costNotConvertible",
  "costUnknownNote",
  "costAmount",
  "costAmountHelp",
  "costUnit",
  "costTaxBasis",
  "taxBasisNet",
  "taxBasisGross",
  "taxBasisUnconfirmed",
  "costTaxBasisHelp",
  "costSource",
  "costSourceManual",
  "costSourceSupplierQuote",
  "costSourceInvoice",
  "costSourceReference",
  "costSourceReferenceLine",
  "costEffectiveFrom",
  "costEffectiveFromLine",
  "costEffectiveFromHelp",
  "saveCost",
  "clearCost",
  "clearCostConfirm",
  "costSaved",
  "costCurrentLine",
  "costPerStorageUnit",
  "costPerRecipeUnit",
  "costRounded",
  "costHistory",
  "costHistoryHelp",
  "costEvidenceTitle",
  "costEvidenceNone",
  "relatedTitle",
  "relatedRecipesNone",
  "relatedStockNone",
  "inventoryEmptyBody",
  "inventoryMasterDataNote",
] as const satisfies readonly StaffUiCopyKey[];

/** Language names are proper nouns and keep their capital inside a sentence. */
const PROPER_NOUNS = new Set(["English", "Arabic"]);

describe("QOS-197 category, filter and reference cost copy", () => {
  const sources = [
    "app/tenants/[tenantId]/inventory/inventory-screen.tsx",
    "app/tenants/[tenantId]/inventory/inventory-client.ts",
    "app/tenants/[tenantId]/inventory/item-editor.tsx",
    "app/tenants/[tenantId]/inventory/category-editor.tsx",
    "app/tenants/[tenantId]/inventory/item-cost-panel.tsx",
    "app/tenants/[tenantId]/inventory/dependency-notice.tsx",
  ]
    .map((relative) => readFileSync(path.join(ROOT, relative), "utf8"))
    .join("\n");

  it.each(QOS_197_COPY_KEYS)("%s has English and Arabic text with no English, ticket ids or shouting", (key) => {
    const en = STAFF_UI_COPY.en[key];
    const ar = STAFF_UI_COPY.ar[key];
    expect(en.trim().length).toBeGreaterThan(0);
    expect(ar).toMatch(/[\u0600-\u06FF]/);
    expect(ar.replace(/\{\w+\}/g, "")).not.toMatch(/[A-Za-z]/);
    for (const text of [en, ar]) expect(text).not.toMatch(/QOS|[A-Z]{2,}-\d/);
    const letters = en.replace(/\{\w+\}/g, "").replace(/[^A-Za-z]/g, "");
    expect(letters !== letters.toUpperCase()).toBe(true);
    const words = en.replace(/\{\w+\}/g, "").split(/\s+/).filter(Boolean);
    words.forEach((word, index) => {
      const sentenceStart = index === 0 || /[.?:]$/.test(words[index - 1]!);
      if (!sentenceStart && !PROPER_NOUNS.has(word)) expect(word, `${key}: ${en}`).not.toMatch(/^[A-Z]/);
    });
  });

  it("pins the inventory notice to stock levels only, in both languages", () => {
    expect(STAFF_UI_COPY.en.inventoryEmptyBody).toBe("Stock levels are not available yet.");
    expect(STAFF_UI_COPY.ar.inventoryEmptyBody).toBe("مستويات المخزون غير متاحة بعد.");
    expect(STAFF_UI_COPY.en.inventoryMasterDataNote).toBe(
      "Units, items, categories, costs, conversions and suppliers apply to every branch. A warehouse belongs to one branch.",
    );
  });

  it("says that a blank cost is not zero", () => {
    expect(STAFF_UI_COPY.en.costUnknownNote).toContain("Blank is not zero.");
    expect(STAFF_UI_COPY.ar.costUnknownNote).toContain("الفراغ ليس صفرًا.");
  });

  it("references every key from the category, filter and cost surfaces", () => {
    const unused = QOS_197_COPY_KEYS.filter((key) => !sources.includes(`"${key}"`));
    expect(unused).toEqual([]);
  });

  it("has Arabic plural forms for the category and cost counts", () => {
    for (const key of ["inventoryCategories", "categoryItems", "costVersions"] as const) {
      const forms = STAFF_COUNT_COPY.ar[key];
      expect(Object.keys(forms).sort(), key).toEqual(["few", "many", "one", "other", "two", "zero"]);
      for (const text of Object.values(forms)) {
        expect(text, key).toMatch(/[\u0600-\u06FF]/);
        expect(text.replace("{count}", ""), key).not.toMatch(/[A-Za-z]/);
      }
    }
    expect(staffCount("ar", "inventoryCategories", 2)).toBe("فئتان");
    expect(staffCount("ar", "inventoryCategories", 3)).toBe("3 فئات");
    expect(staffCount("ar", "categoryItems", 1)).toBe("صنف نشط واحد في هذه الفئة");
    expect(staffCount("ar", "costVersions", 11)).toBe("11 إصدارًا");
    expect(staffCount("en", "categoryItems", 2)).toBe("2 active items are in this category");
    expect(staffCount("en", "costVersions", 1)).toBe("1 version");
  });

  it("keeps the category, filter and cost surfaces free of all-caps styling", () => {
    expect(sources).not.toMatch(/uppercase/i);
  });
});

/* QOS-198: recipe, version, step, link and preview copy follows the QOS-197
   rules: English and Arabic present, no English left in the Arabic (recipe,
   item and product names, codes, dates and amounts are data, not copy),
   nothing shouted, no ticket ids, sentence case, plural forms for every count,
   and every key rendered by the recipe surfaces. The old placeholder body that
   named tickets is gone. */
describe("QOS-198 recipe and sellable link copy", () => {
  const keys = (Object.keys(STAFF_UI_COPY.en) as StaffUiCopyKey[]).filter(
    (key) =>
      ((key.startsWith("recipe") || key.startsWith("link")) && key !== "recipeUnit") ||
      ["relatedOutputOf", "relatedUsedIn", "relatedRecipeVersion"].includes(key),
  );
  const surfaces = [
    "recipes-screen.tsx",
    "recipes-client.ts",
    "recipe-states.tsx",
    "recipe-editor.tsx",
    "recipe-versions-panel.tsx",
    "recipe-lines-panel.tsx",
    "recipe-steps-panel.tsx",
    "recipe-links-panel.tsx",
    "recipe-version-screen.tsx",
    "sellable-links-tab.tsx",
    "link-dialog.tsx",
    "consumption-preview-panel.tsx",
    "recipe-effects-panel.tsx",
  ].map((file) => `app/tenants/[tenantId]/catalogue/recipes/${file}`);
  const sources = [
    ...surfaces,
    "app/tenants/[tenantId]/inventory/item-cost-panel.tsx",
    "app/tenants/[tenantId]/inventory/dependency-notice.tsx",
  ]
    .map((relative) => readFileSync(path.join(ROOT, relative), "utf8"))
    .join("\n");

  it("covers the recipe copy", () => {
    expect(keys.length).toBeGreaterThan(150);
  });

  it.each(keys)("%s has English and Arabic text with no English, ticket ids or shouting", (key) => {
    const en = STAFF_UI_COPY.en[key];
    const ar = STAFF_UI_COPY.ar[key];
    expect(en.trim().length).toBeGreaterThan(0);
    expect(ar).toMatch(/[\u0600-\u06FF]/);
    expect(ar).not.toBe(en);
    expect(ar.replace(/\{\w+\}/g, "")).not.toMatch(/[A-Za-z]/);
    for (const text of [en, ar]) expect(text).not.toMatch(/QOS|[A-Z]{2,}-\d/);
    const letters = en.replace(/\{\w+\}/g, "").replace(/[^A-Za-z]/g, "");
    expect(letters !== letters.toUpperCase()).toBe(true);
    const words = en.replace(/\{\w+\}/g, "").split(/\s+/).filter(Boolean);
    words.forEach((word, index) => {
      const sentenceStart = index === 0 || /[.?:]$/.test(words[index - 1]!);
      if (!sentenceStart && !PROPER_NOUNS.has(word)) expect(word, `${key}: ${en}`).not.toMatch(/^[A-Z]/);
    });
  });

  it("references every recipe key from the recipe surfaces", () => {
    const unused = keys.filter((key) => !sources.includes(`"${key}"`));
    expect(unused).toEqual([]);
  });

  it("drops the ticket-id placeholder and keeps the recipes description and stock-product notice free of ticket ids", () => {
    expect(Object.keys(STAFF_UI_COPY.en)).not.toContain("recipesEmptyBody");
    expect(Object.keys(STAFF_UI_COPY.ar)).not.toContain("recipesEmptyBody");
    for (const key of ["recipesDescription", "productEditorStockIntentUnresolved", "unitInUse"] as const) {
      for (const text of [STAFF_UI_COPY.en[key], STAFF_UI_COPY.ar[key]]) expect(text, key).not.toMatch(/QOS|\d{3}/);
      expect(STAFF_UI_COPY.ar[key], key).not.toMatch(/[A-Za-z]/);
    }
    expect(STAFF_UI_COPY.en.productEditorStockIntentUnresolved).toContain("linked under recipes");
    expect(STAFF_UI_COPY.en.linkNotInWorkbookNotice).toBe(
      "Shared and direct-stock links are set up here only. The workbook template does not import or export them.",
    );
    expect(STAFF_UI_COPY.en.recipeStateNeedsDirectStockLink).toBe("Needs a direct-stock link");
  });

  it("has Arabic plural forms for the recipe counts", () => {
    const countKeys = [
      "recipesCount",
      "recipeLines",
      "recipeSteps",
      "linkedVariants",
      "recipeLinesWithoutCost",
      "recipeLinesDependency",
      "sellableLinksDependency",
      "recipeOutputsDependency",
      "recipeEffects",
      "recipeComponentsWithoutCost",
      "recipeEffectsDependency",
      "relatedDirectStockLinks",
      "productVariants",
    ] as const;
    for (const key of countKeys) {
      const forms = STAFF_COUNT_COPY.ar[key];
      expect(Object.keys(forms).sort(), key).toEqual(["few", "many", "one", "other", "two", "zero"]);
      for (const text of Object.values(forms)) {
        expect(text, key).toMatch(/[\u0600-\u06FF]/);
        expect(text.replace("{count}", ""), key).not.toMatch(/[A-Za-z]/);
      }
      expect(sources, key).toContain(`"${key}"`);
    }
    expect(staffCount("ar", "recipesCount", 2)).toBe("وصفتان");
    expect(staffCount("ar", "recipeLines", 3)).toBe("3 أسطر");
    expect(staffCount("ar", "recipeSteps", 11)).toBe("11 خطوةً");
    expect(staffCount("en", "linkedVariants", 2)).toBe("Linked to 2 variants");
    expect(staffCount("en", "recipeLinesWithoutCost", 1)).toBe("1 line without a cost");
  });

  it("keeps the recipe surfaces free of all-caps styling and the Phase 2 placeholder", () => {
    expect(sources).not.toMatch(/uppercase/i);
    const page = readFileSync(path.join(ROOT, "app/tenants/[tenantId]/catalogue/recipes/page.tsx"), "utf8");
    expect(page).toContain("RecipesScreen");
    expect(page).not.toContain("Phase2EntryScreen");
  });
});

/* Archiving a variant asks first and names a recipe or direct-stock link;
   an archived variant can be restored. Same rules as the recipe copy. */
describe("variant archive confirmation and restore copy", () => {
  const keys: StaffUiCopyKey[] = [
    "variantArchiveConfirmTitle",
    "variantArchiveConfirmBody",
    "variantArchiveConfirmRecipeLink",
    "variantArchiveConfirmStockLink",
    "variantArchived",
    "variantArchivedHelp",
    "variantRestore",
    "variantRestored",
    "variantRestoreError",
  ];
  const sources = [
    "app/tenants/[tenantId]/catalogue/products/product-variants-panel.tsx",
    "app/tenants/[tenantId]/catalogue/products/product-variants-panel-state.ts",
  ]
    .map((relative) => readFileSync(path.join(ROOT, relative), "utf8"))
    .join("\n");

  it.each(keys)("%s has English and Arabic text with no English, ticket ids or shouting", (key) => {
    const en = STAFF_UI_COPY.en[key];
    const ar = STAFF_UI_COPY.ar[key];
    expect(en.trim().length).toBeGreaterThan(0);
    expect(ar).toMatch(/[\u0600-\u06FF]/);
    expect(ar).not.toBe(en);
    expect(ar.replace(/\{\w+\}/g, "")).not.toMatch(/[A-Za-z]/);
    for (const text of [en, ar]) expect(text).not.toMatch(/QOS|[A-Z]{2,}-\d/);
    const words = en.replace(/\{\w+\}/g, "").split(/\s+/).filter(Boolean);
    words.forEach((word, index) => {
      const sentenceStart = index === 0 || /[.?:]$/.test(words[index - 1]!);
      if (!sentenceStart && !PROPER_NOUNS.has(word)) expect(word, `${key}: ${en}`).not.toMatch(/^[A-Z]/);
    });
    expect(sources, key).toContain(`"${key}"`);
  });

  it("keeps the variant panel free of all-caps styling and of the dialog's English defaults", () => {
    expect(sources).not.toMatch(/uppercase/i);
    expect(sources).toContain("confirmLabel={archiveCopy?.confirmLabel}");
    expect(sources).toContain("cancelLabel={archiveCopy?.cancelLabel}");
  });
});
