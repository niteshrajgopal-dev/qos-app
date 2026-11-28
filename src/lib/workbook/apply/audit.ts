import { auditActorClassFromStaffRole, recordTenantAuditEventInTx } from "@/lib/audit/tenant-audit";
import type { DbTransaction } from "@/lib/tenant/context";
import type { ApplyCounts } from "@/lib/workbook/apply/model";

/* Audit events of a workbook apply (QOS-217, decision D-AUDIT). A row event
   is written in the unit's transaction, so it never outlives a rolled-back
   mutation; the services' own events (category, modifier, price, …) are
   written in the same transaction too. Attempt events carry the plan as
   their entity. */

export type ApplyActor = { subject: string; role: "administrator" | "user" };

const ROW_ENTITY_TYPE: Record<string, string> = {
  Categories: "catalogue_category",
  Products: "catalogue_product",
  "Product Categories": "catalogue_product_category",
  Variants: "catalogue_variant",
  "Branch Prices": "location_price_override",
  "Modifier Groups": "catalogue_modifier_group",
  "Modifier Options": "catalogue_modifier_option",
  "Product Modifiers": "catalogue_product_modifier_group",
  Menus: "catalogue_menu",
  "Menu Branches": "catalogue_menu_location",
  "Menu Sections": "catalogue_menu_section",
  "Menu Items": "catalogue_menu_item",
  // QOS-200: the entity types the inventory and recipe services audit under.
  Units: "inventory_unit",
  Suppliers: "inventory_supplier",
  Warehouses: "inventory_warehouse",
  "Inventory Categories": "inventory_category",
  Ingredients: "inventory_item",
  Recipes: "recipe_version",
  "Recipe Lines": "recipe_version",
  "Prep Steps": "recipe_version",
  "Modifier Effects": "recipe_version",
};

export async function recordApplyRowAuditInTx(
  tx: DbTransaction,
  input: {
    tenantId: string;
    actor: ApplyActor;
    planPublicId: string;
    applyPublicId: string;
    sheet: string;
    row: number;
    key: string;
    operation: string;
    entityPublicId: string;
    columns: string[];
    deferred: string[];
  },
) {
  await recordTenantAuditEventInTx(tx, {
    tenantId: input.tenantId,
    actorSubject: input.actor.subject,
    actorClass: auditActorClassFromStaffRole(input.actor.role),
    action: "catalogue.workbook.apply.row",
    entityType: ROW_ENTITY_TYPE[input.sheet] ?? "catalogue_record",
    entityPublicId: input.entityPublicId,
    changeSummary: {
      planPublicId: input.planPublicId,
      applyPublicId: input.applyPublicId,
      sheet: input.sheet,
      row: input.row,
      key: input.key,
      operation: input.operation,
      columns: input.columns,
      deferred: input.deferred,
    },
  });
}

export async function recordApplyAttemptAuditInTx(
  tx: DbTransaction,
  input: {
    tenantId: string;
    actor: ApplyActor;
    action: "start" | "finish" | "interrupted";
    planPublicId: string;
    planRevision: number;
    applyPublicId: string;
    status?: string;
    counts?: Partial<ApplyCounts>;
  },
) {
  await recordTenantAuditEventInTx(tx, {
    tenantId: input.tenantId,
    actorSubject: input.actor.subject,
    actorClass: auditActorClassFromStaffRole(input.actor.role),
    action: `catalogue.workbook.apply.${input.action}`,
    entityType: "workbook_import_plan",
    entityPublicId: input.planPublicId,
    entityVersion: input.planRevision,
    changeSummary: {
      applyPublicId: input.applyPublicId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.counts ? { counts: input.counts } : {}),
    },
  });
}
