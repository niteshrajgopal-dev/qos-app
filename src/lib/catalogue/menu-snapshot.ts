import { createHash } from "node:crypto";

import type { DbClient } from "@/db/client";
import { loadMenuFacts, type MenuFacts, type MenuProductFacts } from "@/lib/catalogue/menu-facts";
import {
  computeMenuHealth,
  type MenuHealthIssueType,
  type MenuHealthReport,
} from "@/lib/catalogue/menu-health";
import { assertMenuLocationAccess, MenuError } from "@/lib/catalogue/menus";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

export const MENU_SNAPSHOT_SCHEMA = "qos.menu_snapshot.v1";
export const MENU_SNAPSHOT_MAX_PRODUCTS = 150;
const MAX_NAME_CHARS = 200;
const MAX_DESCRIPTION_CHARS = 600;
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

type SnapshotText = { name: string; description: string | null };

export type MenuSnapshotProduct = {
  productPublicId: string;
  internalName: string;
  status: MenuProductFacts["status"];
  sectionPublicIds: string[];
  en: SnapshotText | null;
  ar: (SnapshotText & { approvalStatus: string }) | null;
  hasApprovedPhoto: boolean;
  categoryCount: number;
  variants: Array<{
    variantPublicId: string;
    isDefault: boolean;
    prices: Array<{ currency: string; amountMinor: number }>;
  }>;
  modifierGroups: Array<{
    modifierGroupPublicId: string;
    name: string;
    minSelections: number;
    maxSelections: number | null;
    activeOptionCount: number;
  }>;
  availability: Array<{ locationPublicId: string; available: boolean; reason: string | null }>;
  healthIssues: MenuHealthIssueType[];
};

/**
 * The only QOS data a Menu Manager run receives. Public IDs only: no tenant or
 * database UUIDs, no staff, customer, payment or infrastructure data. It is
 * data for the agent, never an authorization token.
 */
export type MenuSnapshot = {
  schema: typeof MENU_SNAPSHOT_SCHEMA;
  generatedAt: string;
  menu: {
    menuPublicId: string;
    version: number;
    displayName: string;
    sectionCount: number;
    locations: Array<{ locationPublicId: string; name: string }>;
  };
  scope: {
    mode: "full_menu" | "selected_products";
    totalMenuProducts: number;
    includedProducts: number;
    /** True when the menu had more products than the snapshot may carry. */
    truncated: boolean;
  };
  health: {
    completenessPercent: number | null;
    issueCounts: Partial<Record<MenuHealthIssueType, number>>;
  };
  products: MenuSnapshotProduct[];
};

export type BuiltMenuSnapshot = {
  snapshot: MenuSnapshot;
  /** Product public IDs the agent may reference in its reply. */
  productPublicIds: string[];
  sha256: string;
};

function clip(value: string | null | undefined, max: number) {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function snapshotProduct(
  product: MenuProductFacts,
  issues: MenuHealthIssueType[],
): MenuSnapshotProduct {
  const en = product.translations.find((row) => row.locale === "en");
  const ar = product.translations.find((row) => row.locale === "ar");

  return {
    productPublicId: product.productPublicId,
    internalName: clip(product.internalName, MAX_NAME_CHARS) ?? "",
    status: product.status,
    sectionPublicIds: product.sectionPublicIds,
    en: en
      ? {
          name: clip(en.displayName, MAX_NAME_CHARS) ?? "",
          description: clip(en.description, MAX_DESCRIPTION_CHARS),
        }
      : null,
    ar: ar
      ? {
          name: clip(ar.displayName, MAX_NAME_CHARS) ?? "",
          description: clip(ar.description, MAX_DESCRIPTION_CHARS),
          approvalStatus: ar.approvalStatus,
        }
      : null,
    hasApprovedPhoto: product.thumbnailPublicId !== null,
    categoryCount: product.categoryCount,
    variants: product.activeVariants.map((variant) => ({
      variantPublicId: variant.publicId,
      isDefault: variant.isDefault,
      prices: variant.prices,
    })),
    modifierGroups: product.modifierGroups.map((group) => ({
      modifierGroupPublicId: group.publicId,
      name: clip(group.internalName, MAX_NAME_CHARS) ?? "",
      minSelections: group.minSelections,
      maxSelections: group.maxSelections,
      activeOptionCount: group.options.filter((option) => option.status === "active").length,
    })),
    // Only the reason code: stop-sale notes are free text written by staff.
    availability: Object.entries(product.eligibilityByLocation).map(
      ([locationPublicId, result]) => ({
        locationPublicId,
        available: result.available,
        reason: result.reason,
      }),
    ),
    healthIssues: issues,
  };
}

export function normalizeSelectedProductPublicIds(selected: readonly string[] | undefined) {
  if (!selected || selected.length === 0) {
    return [];
  }
  const unique = [...new Set(selected.map((id) => id.trim()))];
  if (unique.length > MENU_SNAPSHOT_MAX_PRODUCTS) {
    throw new MenuError(
      `Select at most ${MENU_SNAPSHOT_MAX_PRODUCTS} products.`,
      400,
      "selectedProductPublicIds",
    );
  }
  if (unique.some((id) => !PUBLIC_ID_PATTERN.test(id))) {
    throw new MenuError("A selected product ID is invalid.", 400, "selectedProductPublicIds");
  }
  return unique;
}

/** Pure: turns loaded facts and their health report into the external snapshot. */
export function buildMenuSnapshot(
  facts: MenuFacts,
  health: MenuHealthReport,
  options: { selectedProductPublicIds?: readonly string[] } = {},
): BuiltMenuSnapshot {
  const selected = normalizeSelectedProductPublicIds(options.selectedProductPublicIds);
  const menuProductIds = new Set(facts.products.map((product) => product.productPublicId));
  const unknown = selected.filter((id) => !menuProductIds.has(id));
  if (unknown.length > 0) {
    throw new MenuError(
      "Some selected products are not on this menu.",
      400,
      "selectedProductPublicIds",
    );
  }

  const issuesByProduct = new Map(
    health.products.map((product) => [
      product.productPublicId,
      [...new Set(product.issues.map((issue) => issue.type))],
    ]),
  );

  const candidates =
    selected.length > 0
      ? facts.products.filter((product) => selected.includes(product.productPublicId))
      : facts.products;
  const included = candidates.slice(0, MENU_SNAPSHOT_MAX_PRODUCTS);

  const issueCounts: Partial<Record<MenuHealthIssueType, number>> = {};
  for (const group of health.issueGroups) {
    if (group.productCount > 0) {
      issueCounts[group.type] = group.productCount;
    }
  }

  const snapshot: MenuSnapshot = {
    schema: MENU_SNAPSHOT_SCHEMA,
    generatedAt: facts.evaluatedAt.toISOString(),
    menu: {
      menuPublicId: facts.menuPublicId,
      version: facts.menuVersion,
      displayName: clip(facts.displayName, MAX_NAME_CHARS) ?? "",
      sectionCount: facts.sectionCount,
      locations: facts.locations.map((location) => ({
        locationPublicId: location.publicId,
        name: clip(location.name, MAX_NAME_CHARS) ?? "",
      })),
    },
    scope: {
      mode: selected.length > 0 ? "selected_products" : "full_menu",
      totalMenuProducts: facts.products.length,
      includedProducts: included.length,
      truncated: candidates.length > included.length,
    },
    health: {
      completenessPercent: health.completeness.percent,
      issueCounts,
    },
    products: included.map((product) =>
      snapshotProduct(product, issuesByProduct.get(product.productPublicId) ?? []),
    ),
  };

  return {
    snapshot,
    productPublicIds: included.map((product) => product.productPublicId),
    sha256: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
  };
}

/**
 * Loads the snapshot for an external agent. The caller must hold an active
 * membership; this additionally requires access to the menu's locations
 * before any menu data is read for disclosure.
 */
export async function loadMenuSnapshotForAgent(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  menuPublicId: string,
  options: { selectedProductPublicIds?: readonly string[]; at?: Date } = {},
): Promise<BuiltMenuSnapshot> {
  return withTenantContext(db, tenantId, async (tx) => {
    await assertMenuLocationAccess(tx, tenantId, membership, menuPublicId);

    const facts = await loadMenuFacts(tx, tenantId, menuPublicId, options.at);
    if (!facts) {
      throw new MenuError("Menu not found.", 404);
    }

    return buildMenuSnapshot(facts, computeMenuHealth(facts), {
      selectedProductPublicIds: options.selectedProductPublicIds,
    });
  });
}
