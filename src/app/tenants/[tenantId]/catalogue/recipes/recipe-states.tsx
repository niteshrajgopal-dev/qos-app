"use client";

import { RECIPE_STATE_LABEL, RECIPE_STATE_TONE } from "@/app/tenants/[tenantId]/catalogue/recipes/recipes-client";
import { PortalBadge } from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import type { RecipeStateKey } from "@/lib/recipes/states";
import { staffUiCopy } from "@/lib/staff/locale";

/* QOS-198 state badges. The server derives the states (lib/recipes/states.ts);
   this only maps each key to its EN/AR label and tone. Badges wrap. */
export function RecipeStateBadges({ states }: { states: readonly RecipeStateKey[] }) {
  const { locale } = useStaffLocale();
  if (states.length === 0) {
    return null;
  }
  return (
    <>
      {states.map((state) => (
        <PortalBadge key={state} tone={RECIPE_STATE_TONE[state]} wrap>
          {staffUiCopy(locale, RECIPE_STATE_LABEL[state])}
        </PortalBadge>
      ))}
    </>
  );
}
