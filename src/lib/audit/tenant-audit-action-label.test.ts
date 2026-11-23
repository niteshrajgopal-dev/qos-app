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

  it("labels modifier group deletion in both languages", () => {
    expect(tenantAuditActionLabel("catalogue.modifier_group.delete", "en")).toBe(
      "Modifier group deleted",
    );
    expect(tenantAuditActionLabel("catalogue.modifier_group.delete", "ar")).toBe(
      "تم حذف مجموعة إضافات",
    );
  });

  it("labels every QOS-195 and QOS-196 inventory action, entity and the inventory area in both languages", () => {
    const actions = [
      "inventory.unit.create",
      "inventory.unit.update",
      "inventory.unit.archive",
      "inventory.unit.restore",
      "inventory.item.create",
      "inventory.item.update",
      "inventory.item.archive",
      "inventory.item.restore",
      "inventory.conversion.create",
      "inventory.conversion.revise",
      "inventory.conversion.close",
      "inventory.supplier.create",
      "inventory.supplier.update",
      "inventory.supplier.archive",
      "inventory.supplier.restore",
      "inventory.warehouse.create",
      "inventory.warehouse.update",
      "inventory.warehouse.archive",
      "inventory.warehouse.restore",
    ];
    const english = actions.map((action) => tenantAuditActionLabel(action, "en"));
    const arabic = actions.map((action) => tenantAuditActionLabel(action, "ar"));
    expect(new Set(english).size).toBe(actions.length);
    expect(new Set(arabic).size).toBe(actions.length);
    for (const [index, action] of actions.entries()) {
      expect(english[index], action).not.toBe("Inventory updated");
      expect(english[index], action).not.toContain(".");
      expect(arabic[index], action).toMatch(/^[\u0600-\u06FF\s()]+$/);
    }
    expect(tenantAuditActionLabel("inventory.conversion.revise", "en")).toBe("Item conversion changed (new version)");
    expect(tenantAuditActionLabel("inventory.unit.archive", "ar")).toBe("تمت أرشفة وحدة");
    expect(tenantAuditEntityLabel("inventory_unit", "en")).toBe("Unit");
    expect(tenantAuditEntityLabel("inventory_item", "ar")).toBe("صنف مخزون");
    expect(tenantAuditEntityLabel("inventory_item_conversion", "en")).toBe("Item conversion");
    expect(tenantAuditEntityLabel("inventory_item_conversion", "ar")).toBe("تحويل صنف");
    expect(tenantAuditActionLabel("inventory.supplier.archive", "en")).toBe("Supplier archived");
    expect(tenantAuditActionLabel("inventory.warehouse.create", "ar")).toBe("تم إنشاء مستودع");
    expect(tenantAuditEntityLabel("inventory_supplier", "en")).toBe("Supplier");
    expect(tenantAuditEntityLabel("inventory_supplier", "ar")).toBe("مورّد");
    expect(tenantAuditEntityLabel("inventory_warehouse", "en")).toBe("Warehouse");
    expect(tenantAuditEntityLabel("inventory_warehouse", "ar")).toBe("مستودع");
    expect(tenantAuditActionLabel("inventory.something_new", "en")).toBe("Inventory updated");
    expect(tenantAuditActionLabel("inventory.something_new", "ar")).toBe("تم تحديث المخزون");
  });

  it("falls back by area, then generically, instead of echoing the action string", () => {
    expect(tenantAuditActionLabel("catalogue.something_new", "en")).toBe("Catalogue updated");
    expect(tenantAuditActionLabel("catalogue.something_new", "ar")).toBe("تم تحديث الكتالوج");
    expect(tenantAuditActionLabel("unheard.of", "ar")).toBe("تم تسجيل نشاط");
    expect(tenantAuditEntityLabel("unheard_entity", "ar")).toBe("سجل");
  });
});
