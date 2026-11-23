"use client";

import { PortalNotice } from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import type { Dependency } from "@/lib/inventory/errors";
import { staffCount, staffUiCopy } from "@/lib/staff/locale";

/* QOS-196: explains a refused archive or reassignment with the records that
   block it, as returned in the API's `dependencies` list. Kinds without copy
   yet (stock records arrive with later leaves) are not listed; the error text
   above the list still explains the refusal. */

export function DependencyNotice({ message, dependencies }: { message: string; dependencies: Dependency[] }) {
  const { locale } = useStaffLocale();
  const lines = dependencies.flatMap((dependency) =>
    dependency.kind === "inventory_items" ? [staffCount(locale, "supplierItems", dependency.count)] : [],
  );
  return (
    <div className="qosp-stack">
      <PortalNotice tone="error">
        <strong>{staffUiCopy(locale, "inventoryDependenciesTitle")}</strong> {message}
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
