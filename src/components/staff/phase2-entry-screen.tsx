"use client";

import { EmptyState } from "@/components/EmptyState";
import { usePortalShell } from "@/components/portal/portal-shell-context";
import {
  PortalArea,
  PortalPageHeader,
  PortalPanel,
} from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { branchSelectionName, isolateText } from "@/lib/staff/branch-copy";
import { staffCopyWith, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";

/* Honest entry pages for Phase 2 areas whose services do not exist yet
   (QOS-192). They show no data, offer no actions and name the leaf that
   delivers the area, plus the branch context the area will open in. */

export type Phase2EntryArea = "inventory" | "kitchen" | "sales" | "reports" | "recipes";

const AREA_COPY: Record<
  Phase2EntryArea,
  { title: StaffUiCopyKey; description: StaffUiCopyKey; body: StaffUiCopyKey; icon: string }
> = {
  inventory: {
    title: "ingredientsAndStock",
    description: "inventoryDescription",
    body: "inventoryEmptyBody",
    icon: "boxes",
  },
  kitchen: {
    title: "kitchen",
    description: "kitchenDescription",
    body: "kitchenEmptyBody",
    icon: "chef-hat",
  },
  sales: {
    title: "sales",
    description: "salesDescription",
    body: "salesEmptyBody",
    icon: "receipt",
  },
  reports: {
    title: "reports",
    description: "reportsDescription",
    body: "reportsEmptyBody",
    icon: "bar-chart-3",
  },
  recipes: {
    title: "recipes",
    description: "recipesDescription",
    body: "recipesEmptyBody",
    icon: "book-open",
  },
};

export function BranchContextLine() {
  const { branch } = usePortalShell();
  const { locale } = useStaffLocale();
  const name = branchSelectionName(locale, branch.selection, branch.branches);
  const value =
    branch.status === "ready"
      ? (name ?? staffUiCopy(locale, "noBranches"))
      : staffUiCopy(locale, branch.status === "error" ? "branchUnavailable" : "branchLoading");

  return (
    <span className="qosp-meta-line" role="status">
      {staffCopyWith(locale, "phase2BranchContext", { branch: isolateText(value) })}
    </span>
  );
}

export function Phase2EntryScreen({ area }: { area: Phase2EntryArea }) {
  const { locale } = useStaffLocale();
  const copy = AREA_COPY[area];

  return (
    <PortalArea>
      <PortalPageHeader
        title={staffUiCopy(locale, copy.title)}
        description={staffUiCopy(locale, copy.description)}
        meta={<BranchContextLine />}
      />
      <PortalPanel>
        <EmptyState
          icon={copy.icon}
          title={staffUiCopy(locale, "phase2NotAvailableTitle")}
          body={staffUiCopy(locale, copy.body)}
        />
      </PortalPanel>
    </PortalArea>
  );
}
