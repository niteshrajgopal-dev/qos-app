import { describe, expect, it } from "vitest";

import {
  tenantAuditActionLabel,
  tenantAuditEntityLabel,
} from "@/lib/audit/tenant-audit-action-label";

describe("tenantAuditActionLabel", () => {
  it("labels menu extraction cancel audit events as cancelled", () => {
    expect(tenantAuditActionLabel("catalogue.menu_extraction.cancelled")).toBe(
      "Catalogue menu extraction cancelled",
    );
    expect(tenantAuditActionLabel("catalogue.menu_extraction.rejected")).toBe(
      "Catalogue menu extraction cancelled",
    );
  });

  it("replaces the raw system strings QA saw with readable labels in both languages", () => {
    expect(tenantAuditActionLabel("ai_spend.reserved", "en")).toBe("AI budget reserved");
    expect(tenantAuditActionLabel("ai_spend.reserved", "ar")).toBe(
      "تم حجز ميزانية الذكاء الاصطناعي",
    );
    expect(tenantAuditActionLabel("storefront.publish", "ar")).toBe("تم نشر واجهة المتجر");
    expect(tenantAuditEntityLabel("catalogue_product", "en")).toBe("Product");
    expect(tenantAuditEntityLabel("catalogue_product", "ar")).toBe("منتج");
  });

  it("falls back by area, then generically, instead of echoing the action string", () => {
    expect(tenantAuditActionLabel("catalogue.something_new", "en")).toBe("Catalogue updated");
    expect(tenantAuditActionLabel("catalogue.something_new", "ar")).toBe("تم تحديث الكتالوج");
    expect(tenantAuditActionLabel("unheard.of", "ar")).toBe("تم تسجيل نشاط");
    expect(tenantAuditEntityLabel("unheard_entity", "ar")).toBe("سجل");
  });
});
