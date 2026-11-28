"use client";

import { PortalBadge } from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { staffCount, staffUiCopy } from "@/lib/staff/locale";
import { pendingSheets, sheetLabel } from "@/lib/workbook/review-view";
import type { WorkbookReviewResult } from "@/lib/workbook/validation/model";

/* QOS-200 (D6): sheets the import reads and keeps with the plan but never
   applies — prep targets and provider mappings until their services exist,
   opening stock because it is posted through its own intake, and combos,
   which are rejected in Phase 2 — each with its row count and plain
   disposition. Shown in the review and in the apply results. */
export function WorkbookPendingSheets({ sheets }: { sheets: WorkbookReviewResult["sheets"] }) {
  const { locale } = useStaffLocale();
  const pending = pendingSheets(sheets);
  if (pending.length === 0) return null;
  return (
    <section aria-labelledby="workbook-pending-title">
      <h4 id="workbook-pending-title" className="qosp-subcard-title qosp-panel-body">
        {staffUiCopy(locale, "reviewPendingTitle")}
      </h4>
      <p className="qosp-panel-help">{staffUiCopy(locale, "reviewPendingSentence")}</p>
      <ul className="qosp-branch-list qosp-panel-body" aria-labelledby="workbook-pending-title">
        {pending.map((entry) => (
          <li key={entry.sheet} className="qosp-subcard">
            <div className="qosp-meta-row">
              <p className="qosp-field-label">{sheetLabel(locale, entry.sheet)}</p>
              <PortalBadge tone={entry.rejected ? "neutral" : "warm"}>
                {staffUiCopy(locale, entry.rejected ? "reviewPendingRejected" : "reviewPendingKept")}
              </PortalBadge>
            </div>
            <p className="qosp-meta-line">{staffCount(locale, "reviewPendingRows", entry.rowCount)}</p>
            <p className="qosp-panel-help">{staffUiCopy(locale, entry.owner)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
