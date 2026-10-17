import { describe, expect, it } from "vitest";

import { tenantAuditActionLabel } from "@/lib/audit/tenant-audit-action-label";

describe("tenantAuditActionLabel", () => {
  it("labels menu extraction cancel audit events as cancelled", () => {
    expect(tenantAuditActionLabel("catalogue.menu_extraction.cancelled")).toBe(
      "Catalogue menu extraction cancelled",
    );
    expect(tenantAuditActionLabel("catalogue.menu_extraction.rejected")).toBe(
      "Catalogue menu extraction cancelled",
    );
  });
});
