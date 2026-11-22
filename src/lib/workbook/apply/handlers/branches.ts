import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import type { SheetHandler } from "@/lib/workbook/apply/handlers/types";

/* Branches are an anchor only: locations are managed in Settings → Branches
   (QOS-192). The review never proposes a Branches create or update, so a
   unit here means a tampered plan; it fails closed. */
export const applyBranches: SheetHandler = async () => {
  throw new ApplyUnitError("unsupported_field", "Branches are managed in Settings → Branches.", { reason: "branches_anchor_only" });
};
