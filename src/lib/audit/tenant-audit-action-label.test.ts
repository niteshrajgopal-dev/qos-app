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

  it("labels variant update, archive and restore in both languages, each distinct from the area fallback", () => {
    const actions = ["catalogue.variant.update", "catalogue.variant.archive", "catalogue.variant.restore"];
    const english = actions.map((action) => tenantAuditActionLabel(action, "en"));
    const arabic = actions.map((action) => tenantAuditActionLabel(action, "ar"));
    expect(english).toEqual(["Variant updated", "Variant archived", "Variant restored"]);
    expect(arabic).toEqual(["تم تحديث متغيّر", "تمت أرشفة متغيّر", "تمت استعادة متغيّر"]);
    expect(english).not.toContain(tenantAuditActionLabel("catalogue.unlabelled_action", "en"));
    for (const text of arabic) expect(text).toMatch(/^[\u0600-\u06FF\s]+$/);
  });

  it("labels modifier group deletion in both languages", () => {
    expect(tenantAuditActionLabel("catalogue.modifier_group.delete", "en")).toBe(
      "Modifier group deleted",
    );
    expect(tenantAuditActionLabel("catalogue.modifier_group.delete", "ar")).toBe(
      "تم حذف مجموعة إضافات",
    );
  });

  it("labels every QOS-195, QOS-196 and QOS-197 inventory action, entity and the inventory area in both languages", () => {
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
      "inventory.category.create",
      "inventory.category.update",
      "inventory.category.archive",
      "inventory.category.restore",
      "inventory.reference_cost.create",
      "inventory.reference_cost.revise",
      "inventory.reference_cost.close",
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
    expect(tenantAuditActionLabel("inventory.category.archive", "en")).toBe("Inventory category archived");
    expect(tenantAuditActionLabel("inventory.category.restore", "ar")).toBe("تمت استعادة فئة مخزون");
    expect(tenantAuditActionLabel("inventory.reference_cost.revise", "en")).toBe("Item reference cost changed (new dated version)");
    expect(tenantAuditActionLabel("inventory.reference_cost.close", "ar")).toBe("تم مسح التكلفة المرجعية لصنف");
    expect(tenantAuditEntityLabel("inventory_category", "en")).toBe("Inventory category");
    expect(tenantAuditEntityLabel("inventory_category", "ar")).toBe("فئة مخزون");
    expect(tenantAuditEntityLabel("inventory_item_reference_cost", "en")).toBe("Item reference cost");
    expect(tenantAuditEntityLabel("inventory_item_reference_cost", "ar")).toBe("تكلفة مرجعية لصنف");
    expect(tenantAuditActionLabel("inventory.something_new", "en")).toBe("Inventory updated");
    expect(tenantAuditActionLabel("inventory.something_new", "ar")).toBe("تم تحديث المخزون");
  });

  it("labels every QOS-198 recipe and sellable link action, entity and the recipes area in both languages", () => {
    const actions = [
      "recipe.create",
      "recipe.update",
      "recipe.archive",
      "recipe.restore",
      "recipe.version.create",
      "recipe.version.update",
      "recipe.version.lines.update",
      "recipe.version.steps.update",
      "recipe.version.effects.update",
      "recipe.version.approve",
      "recipe.version.discard",
      "recipe.link.create",
      "recipe.link.end",
    ];
    const english = actions.map((action) => tenantAuditActionLabel(action, "en"));
    const arabic = actions.map((action) => tenantAuditActionLabel(action, "ar"));
    expect(new Set(english).size).toBe(actions.length);
    expect(new Set(arabic).size).toBe(actions.length);
    for (const [index, action] of actions.entries()) {
      expect(english[index], action).not.toBe("Recipes updated");
      expect(english[index], action).not.toContain(".");
      expect(english[index], action).not.toMatch(/QOS/);
      expect(arabic[index], action).toMatch(/^[\u0600-\u06FF\s()]+$/);
    }
    expect(tenantAuditActionLabel("recipe.version.approve", "en")).toBe("Recipe version approved");
    expect(tenantAuditActionLabel("recipe.version.effects.update", "en")).toBe("Recipe modifier effects changed");
    expect(tenantAuditActionLabel("recipe.version.effects.update", "ar")).toBe("تم تغيير تأثيرات المعدِّلات في وصفة");
    expect(tenantAuditActionLabel("recipe.link.end", "ar")).toBe("تم إنهاء ربط بيع");
    expect(tenantAuditEntityLabel("recipe", "en")).toBe("Recipe");
    expect(tenantAuditEntityLabel("recipe_version", "ar")).toBe("إصدار وصفة");
    expect(tenantAuditEntityLabel("recipe_sellable_link", "en")).toBe("Sellable link");
    expect(tenantAuditActionLabel("recipe.something_new", "en")).toBe("Recipes updated");
    expect(tenantAuditActionLabel("recipe.something_new", "ar")).toBe("تم تحديث الوصفات");
  });

  it("falls back by area, then generically, instead of echoing the action string", () => {
    expect(tenantAuditActionLabel("catalogue.something_new", "en")).toBe("Catalogue updated");
    expect(tenantAuditActionLabel("catalogue.something_new", "ar")).toBe("تم تحديث الكتالوج");
    expect(tenantAuditActionLabel("unheard.of", "ar")).toBe("تم تسجيل نشاط");
    expect(tenantAuditEntityLabel("unheard_entity", "ar")).toBe("سجل");
  });
});
