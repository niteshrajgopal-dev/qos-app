import { ALL_BRANCHES, type BranchSelection, type BusinessBranchLabelKey, type PermittedBranch } from "@/lib/staff/branch-selection";
import { staffUiCopy, type StaffLocale, type StaffUiCopyKey } from "@/lib/staff/locale";

/* Display helpers for branch context copy. Location names are tenant data and
   may be in a different script from the UI, so interpolated names are wrapped
   in Unicode isolates to keep RTL punctuation where it belongs. */

export function isolateText(text: string): string {
  return `⁨${text}⁩`;
}

export function branchSelectionName(
  locale: StaffLocale,
  selection: BranchSelection | null,
  branches: readonly PermittedBranch[],
): string | null {
  if (selection === null) {
    return null;
  }
  if (selection === ALL_BRANCHES) {
    return staffUiCopy(locale, "allBranches");
  }
  return branches.find((branch) => branch.publicId === selection)?.name ?? null;
}

export function branchStatusLabel(locale: StaffLocale, status: PermittedBranch["status"]) {
  return staffUiCopy(locale, status === "active" ? "branchStatusActive" : "branchStatusSuspended");
}

const BUSINESS_LABEL_COPY: Record<BusinessBranchLabelKey, StaffUiCopyKey> = {
  dubai: "branchLabelDubai",
  "al-ain": "branchLabelAlAin",
  "azur-cafe": "branchLabelAzurCafe",
};

export function businessBranchLabel(locale: StaffLocale, key: BusinessBranchLabelKey) {
  return staffUiCopy(locale, BUSINESS_LABEL_COPY[key]);
}
