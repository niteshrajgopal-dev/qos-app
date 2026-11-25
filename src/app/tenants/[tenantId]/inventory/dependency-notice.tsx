"use client";

import { PortalNotice } from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import type { Dependency } from "@/lib/inventory/errors";
import { type StaffCountKey, staffCount, staffUiCopy } from "@/lib/staff/locale";

/* QOS-196: explains a refused archive or reassignment with the records that
   block it, as returned in the API's `dependencies` list. Kinds without copy
   yet (stock records arrive with later leaves) are not listed; the error text
   above the list still explains the refusal. QOS-197: `itemsCountKey` words
   the item count for the screen (a supplier's or a category's items).
   QOS-198 adds the recipe lines, sellable links and prepared recipes that
   keep an item (or a recipe) in use; QOS-199 the modifier effects. */

const RECIPE_DEPENDENCY_COPY: Partial<Record<string, StaffCountKey>> = {
  recipe_lines: "recipeLinesDependency",
  sellable_links: "sellableLinksDependency",
  recipe_outputs: "recipeOutputsDependency",
  recipe_effects: "recipeEffectsDependency",
};

export function DependencyNotice({
  message,
  dependencies,
  itemsCountKey = "supplierItems",
}: {
  message: string;
  dependencies: Dependency[];
  itemsCountKey?: Extract<StaffCountKey, "supplierItems" | "categoryItems">;
}) {
  const { locale } = useStaffLocale();
  const lines = dependencies.flatMap((dependency) => {
    if (dependency.kind === "inventory_items") return [staffCount(locale, itemsCountKey, dependency.count)];
    const key = RECIPE_DEPENDENCY_COPY[dependency.kind];
    return key ? [staffCount(locale, key, dependency.count)] : [];
  });
  return (
    <div className="qosp-stack">
      <PortalNotice tone="error">
        <span>
          <strong>{staffUiCopy(locale, "inventoryDependenciesTitle")}</strong> {message}
        </span>
      </PortalNotice>
      {lines.length > 0 ? (
        <ul className="qosp-meta-line">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
