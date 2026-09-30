import type { DbClient } from "@/db/client";
import {
  loadMenuFacts,
  type MenuFacts,
  type MenuProductFacts,
} from "@/lib/catalogue/menu-facts";
import { assertMenuLocationAccess, MenuError } from "@/lib/catalogue/menus";
import { assertModifierDefaultsAreFeasible } from "@/lib/catalogue/modifier-selection";
import { evaluateProductTranslationsForPublish } from "@/lib/catalogue/translation-approval";
import { CatalogueValidationError } from "@/lib/catalogue/validation";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

export const MENU_HEALTH_ISSUE_TYPES = [
  "missing_photo",
  "missing_description",
  "missing_translation",
  "modifier_issue",
  "missing_price",
  "uncategorised",
  "duplicate_name",
  "stop_sale",
] as const;

export type MenuHealthIssueType = (typeof MENU_HEALTH_ISSUE_TYPES)[number];

export type MenuHealthSeverity = "info" | "warning" | "blocking";

export const MENU_HEALTH_SEVERITY: Record<MenuHealthIssueType, MenuHealthSeverity> = {
  missing_photo: "warning",
  missing_description: "warning",
  missing_translation: "blocking",
  modifier_issue: "blocking",
  missing_price: "blocking",
  uncategorised: "info",
  duplicate_name: "warning",
  stop_sale: "info",
};

/** Issue types that count towards completeness; the rest are advisory. */
const COMPLETENESS_ISSUE_TYPES: MenuHealthIssueType[] = [
  "missing_photo",
  "missing_description",
  "missing_translation",
  "modifier_issue",
  "missing_price",
  "uncategorised",
];

export type MenuHealthProductIssue = {
  type: MenuHealthIssueType;
  message: string;
};

export type MenuHealthProduct = {
  productPublicId: string;
  displayName: string;
  internalName: string;
  thumbnailPublicId: string | null;
  issues: MenuHealthProductIssue[];
};

export type MenuHealthIssueGroup = {
  type: MenuHealthIssueType;
  severity: MenuHealthSeverity;
  productCount: number;
  productPublicIds: string[];
};

export type MenuHealthReport = {
  menuPublicId: string;
  menuVersion: number;
  menuDisplayName: string;
  evaluatedAt: string;
  totals: {
    products: number;
    sections: number;
    locations: number;
    productsWithIssues: number;
  };
  completeness: {
    /** Null when the menu has no items to evaluate. */
    percent: number | null;
    passedChecks: number;
    totalChecks: number;
  };
  issueGroups: MenuHealthIssueGroup[];
  products: MenuHealthProduct[];
  availability: {
    checkedLocations: Array<{ publicId: string; name: string }>;
    /** Closed right now, so stop-sale status could not be evaluated. */
    closedLocations: Array<{ publicId: string; name: string }>;
  };
};

export function normalizeProductNameForDuplicates(name: string) {
  return name
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function translation(product: MenuProductFacts, locale: "en" | "ar") {
  return product.translations.find((row) => row.locale === locale);
}

function productDisplayName(product: MenuProductFacts) {
  return translation(product, "en")?.displayName.trim() || product.internalName;
}

function descriptionIssues(product: MenuProductFacts): MenuHealthProductIssue[] {
  if (!translation(product, "en")?.description?.trim()) {
    return [{ type: "missing_description", message: "English description is missing." }];
  }

  if (!translation(product, "ar")?.description?.trim()) {
    return [{ type: "missing_description", message: "Arabic description is missing." }];
  }

  return [];
}

function priceIssues(product: MenuProductFacts): MenuHealthProductIssue[] {
  if (product.activeVariants.length === 0) {
    return [{ type: "missing_price", message: "No active variant, so the item has no price." }];
  }

  const unpriced = product.activeVariants.filter(
    (variant) => variant.prices.length === 0,
  );
  if (unpriced.length === 0) {
    return [];
  }

  return [
    {
      type: "missing_price",
      message:
        unpriced.length === 1
          ? `Variant ${unpriced[0].publicId} has no price.`
          : `${unpriced.length} variants have no price.`,
    },
  ];
}

function modifierIssues(product: MenuProductFacts): MenuHealthProductIssue[] {
  const issues: MenuHealthProductIssue[] = [];

  for (const group of product.modifierGroups) {
    if (!group.options.some((option) => option.status === "active")) {
      issues.push({
        type: "modifier_issue",
        message: `Modifier group "${group.internalName}" has no active options.`,
      });
      continue;
    }

    try {
      assertModifierDefaultsAreFeasible(group);
    } catch (error) {
      if (!(error instanceof CatalogueValidationError)) {
        throw error;
      }
      issues.push({
        type: "modifier_issue",
        message: `Modifier group "${group.internalName}": ${error.message}`,
      });
    }
  }

  return issues;
}

/**
 * Deterministic menu health. Pure: no database, network or AI calls, so the
 * same facts always produce the same report.
 */
export function computeMenuHealth(facts: MenuFacts): MenuHealthReport {
  const locationNames = new Map(
    facts.locations.map((location) => [location.publicId, location.name]),
  );
  const closedLocationIds = new Set<string>();

  const products: MenuHealthProduct[] = facts.products.map((product) => {
    const issues: MenuHealthProductIssue[] = [];

    if (!product.thumbnailPublicId) {
      issues.push({ type: "missing_photo", message: "No approved photo." });
    }

    issues.push(...descriptionIssues(product));

    for (const issue of evaluateProductTranslationsForPublish(
      product.productPublicId,
      product.translations,
    )) {
      issues.push({ type: "missing_translation", message: issue.message });
    }

    issues.push(...modifierIssues(product));
    issues.push(...priceIssues(product));

    if (product.categoryCount === 0) {
      issues.push({ type: "uncategorised", message: "Not assigned to any category." });
    }

    for (const [locationPublicId, eligibility] of Object.entries(
      product.eligibilityByLocation,
    )) {
      if (eligibility.reason === "location_closed") {
        closedLocationIds.add(locationPublicId);
      }
      if (eligibility.reason === "stop_sale") {
        issues.push({
          type: "stop_sale",
          message: `On stop-sale at ${locationNames.get(locationPublicId) ?? locationPublicId}.`,
        });
      }
    }

    return {
      productPublicId: product.productPublicId,
      displayName: productDisplayName(product),
      internalName: product.internalName,
      thumbnailPublicId: product.thumbnailPublicId,
      issues,
    };
  });

  const productsByName = new Map<string, MenuHealthProduct[]>();
  for (const product of products) {
    const key = normalizeProductNameForDuplicates(product.displayName);
    if (!key) {
      continue;
    }
    productsByName.set(key, [...(productsByName.get(key) ?? []), product]);
  }
  for (const group of productsByName.values()) {
    if (group.length < 2) {
      continue;
    }
    for (const product of group) {
      const others = group
        .filter((other) => other !== product)
        .map((other) => other.productPublicId);
      product.issues.push({
        type: "duplicate_name",
        message: `Same name as ${others.join(", ")}.`,
      });
    }
  }

  const issueGroups: MenuHealthIssueGroup[] = MENU_HEALTH_ISSUE_TYPES.map(
    (type) => {
      const productPublicIds = products
        .filter((product) => product.issues.some((issue) => issue.type === type))
        .map((product) => product.productPublicId);
      return {
        type,
        severity: MENU_HEALTH_SEVERITY[type],
        productCount: productPublicIds.length,
        productPublicIds,
      };
    },
  );

  const totalChecks = products.length * COMPLETENESS_ISSUE_TYPES.length;
  const failedChecks = products.reduce(
    (sum, product) =>
      sum +
      COMPLETENESS_ISSUE_TYPES.filter((type) =>
        product.issues.some((issue) => issue.type === type),
      ).length,
    0,
  );
  const passedChecks = totalChecks - failedChecks;

  return {
    menuPublicId: facts.menuPublicId,
    menuVersion: facts.menuVersion,
    menuDisplayName: facts.displayName,
    evaluatedAt: facts.evaluatedAt.toISOString(),
    totals: {
      products: products.length,
      sections: facts.sectionCount,
      locations: facts.locations.length,
      productsWithIssues: products.filter((product) => product.issues.length > 0)
        .length,
    },
    completeness: {
      percent:
        totalChecks === 0 ? null : Math.floor((passedChecks / totalChecks) * 100),
      passedChecks,
      totalChecks,
    },
    issueGroups,
    products,
    availability: {
      checkedLocations: facts.locations
        .filter((location) => !closedLocationIds.has(location.publicId))
        .map(({ publicId, name }) => ({ publicId, name })),
      closedLocations: facts.locations
        .filter((location) => closedLocationIds.has(location.publicId))
        .map(({ publicId, name }) => ({ publicId, name })),
    },
  };
}

export async function getMenuHealth(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  menuPublicId: string,
  options: { at?: Date } = {},
): Promise<MenuHealthReport> {
  return withTenantContext(db, tenantId, async (tx) => {
    await assertMenuLocationAccess(tx, tenantId, membership, menuPublicId);

    const facts = await loadMenuFacts(tx, tenantId, menuPublicId, options.at);
    if (!facts) {
      throw new MenuError("Menu not found.", 404);
    }

    return computeMenuHealth(facts);
  });
}
