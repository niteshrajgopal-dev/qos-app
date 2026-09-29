import type {
  MenuHealthIssueGroup,
  MenuHealthIssueType,
  MenuHealthReport,
  MenuHealthSeverity,
} from "@/lib/catalogue/menu-health";

export const MENU_HEALTH_ISSUE_COPY: Record<
  MenuHealthIssueType,
  { title: string; description: string; fixLabel: string; fixPath: "edit" | "translations" }
> = {
  missing_photo: {
    title: "Missing photos",
    description: "No approved photo, so the item shows without an image.",
    fixLabel: "Add photo",
    fixPath: "edit",
  },
  missing_description: {
    title: "Missing descriptions",
    description: "English or Arabic description is empty.",
    fixLabel: "Edit item",
    fixPath: "edit",
  },
  missing_translation: {
    title: "Translations not ready",
    description: "Missing, unapproved or stale translations block publishing.",
    fixLabel: "Review translations",
    fixPath: "translations",
  },
  modifier_issue: {
    title: "Modifier configuration",
    description: "Modifier groups that customers cannot complete as configured.",
    fixLabel: "Edit item",
    fixPath: "edit",
  },
  missing_price: {
    title: "Missing prices",
    description: "No active priced variant.",
    fixLabel: "Edit item",
    fixPath: "edit",
  },
  uncategorised: {
    title: "Uncategorised",
    description: "Not assigned to any catalogue category.",
    fixLabel: "Edit item",
    fixPath: "edit",
  },
  duplicate_name: {
    title: "Likely duplicates",
    description: "Items in this menu with the same English name.",
    fixLabel: "Edit item",
    fixPath: "edit",
  },
  stop_sale: {
    title: "On stop-sale",
    description: "Currently on stop-sale at one of this menu's locations.",
    fixLabel: "Edit item",
    fixPath: "edit",
  },
};

const SEVERITY_ORDER: Record<MenuHealthSeverity, number> = {
  blocking: 0,
  warning: 1,
  info: 2,
};

export const SEVERITY_BADGE_TONE: Record<MenuHealthSeverity, "error" | "warning" | "info"> = {
  blocking: "error",
  warning: "warning",
  info: "info",
};

/** Groups with at least one item, most severe first, stable within a severity. */
export function visibleIssueGroups(report: MenuHealthReport): MenuHealthIssueGroup[] {
  return report.issueGroups
    .map((group, index) => ({ group, index }))
    .filter(({ group }) => group.productCount > 0)
    .sort(
      (left, right) =>
        SEVERITY_ORDER[left.group.severity] - SEVERITY_ORDER[right.group.severity] ||
        left.index - right.index,
    )
    .map(({ group }) => group);
}

export function productsForIssueType(
  report: MenuHealthReport,
  type: MenuHealthIssueType,
) {
  return report.products
    .filter((product) => product.issues.some((issue) => issue.type === type))
    .map((product) => ({
      productPublicId: product.productPublicId,
      displayName: product.displayName,
      messages: product.issues
        .filter((issue) => issue.type === type)
        .map((issue) => issue.message),
    }));
}

export function menuHealthHeadline(report: MenuHealthReport) {
  const { products, productsWithIssues } = report.totals;

  if (products === 0) {
    return "This menu has no items to check yet.";
  }

  if (productsWithIssues === 0) {
    return `All ${products} ${products === 1 ? "item passes" : "items pass"} the menu health checks.`;
  }

  return `${productsWithIssues} of ${products} ${products === 1 ? "item needs" : "items need"} attention.`;
}

export function productFixHref(
  tenantId: string,
  productPublicId: string,
  type: MenuHealthIssueType,
) {
  const base = `/tenants/${tenantId}/catalogue/products/${productPublicId}`;
  return MENU_HEALTH_ISSUE_COPY[type].fixPath === "translations"
    ? `${base}/translations`
    : `${base}/edit`;
}
