import type {
  MenuHealthIssueGroup,
  MenuHealthIssueType,
  MenuHealthReport,
  MenuHealthSeverity,
} from "@/lib/catalogue/menu-health";
import type { StaffLocale } from "@/lib/staff/locale";

import { menusCopy, menusCount } from "./menus-copy";

type IssueCopy = { title: string; description: string; fixLabel: string };

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

const MENU_HEALTH_ISSUE_COPY_AR: Record<MenuHealthIssueType, IssueCopy> = {
  missing_photo: {
    title: "صور ناقصة",
    description: "لا توجد صورة معتمدة، لذا يظهر الصنف بلا صورة.",
    fixLabel: "إضافة صورة",
  },
  missing_description: {
    title: "أوصاف ناقصة",
    description: "الوصف بالإنجليزية أو بالعربية فارغ.",
    fixLabel: "تعديل الصنف",
  },
  missing_translation: {
    title: "ترجمات غير جاهزة",
    description: "الترجمات الناقصة أو غير المعتمدة أو القديمة تمنع النشر.",
    fixLabel: "مراجعة الترجمات",
  },
  modifier_issue: {
    title: "إعداد الإضافات",
    description: "مجموعات إضافات لا يستطيع العملاء إكمالها بإعدادها الحالي.",
    fixLabel: "تعديل الصنف",
  },
  missing_price: {
    title: "أسعار ناقصة",
    description: "لا يوجد متغيّر نشط له سعر.",
    fixLabel: "تعديل الصنف",
  },
  uncategorised: {
    title: "بلا تصنيف",
    description: "غير مُسند إلى أي تصنيف في الكتالوج.",
    fixLabel: "تعديل الصنف",
  },
  duplicate_name: {
    title: "تكرارات محتملة",
    description: "أصناف في هذه القائمة تحمل الاسم الإنجليزي نفسه.",
    fixLabel: "تعديل الصنف",
  },
  stop_sale: {
    title: "موقوفة عن البيع",
    description: "موقوف عن البيع حاليًا في أحد فروع هذه القائمة.",
    fixLabel: "تعديل الصنف",
  },
};

export function menuHealthIssueCopy(
  type: MenuHealthIssueType,
  locale: StaffLocale = "en",
): IssueCopy {
  return locale === "ar" ? MENU_HEALTH_ISSUE_COPY_AR[type] : MENU_HEALTH_ISSUE_COPY[type];
}

export function severityLabel(severity: MenuHealthSeverity, locale: StaffLocale = "en") {
  if (severity === "blocking") {
    return menusCopy(locale, "severityBlocking");
  }
  return severity === "warning"
    ? menusCopy(locale, "severityWarning")
    : menusCopy(locale, "severityInfo");
}

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

export function menuHealthHeadline(report: MenuHealthReport, locale: StaffLocale = "en") {
  const { products, productsWithIssues } = report.totals;

  if (products === 0) {
    return menusCopy(locale, "healthNoItems");
  }

  if (productsWithIssues === 0) {
    return menusCount(locale, "allItemsPass", products);
  }

  return menusCount(locale, "itemsNeedAttention", products, { issues: productsWithIssues });
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
