import { and, eq } from "drizzle-orm";

import {
  catalogueCategories,
  catalogueMenus,
  catalogueMenuSections,
  catalogueModifierGroups,
  catalogueModifierOptions,
  catalogueProducts,
  catalogueVariants,
  workbookSourceLinks,
} from "@/db/schema";
import type { DbTransaction } from "@/lib/tenant/context";
import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import type { AppliedLink, TypedLinkEntity } from "@/lib/workbook/apply/model";

/* Typed source links (QOS-217, decision D-LINKS): workbook key → QOS public
   id per entity type within a source namespace. Written in the same
   transaction as the record they point at, for entity sheets only (links
   between records are identified by their two endpoints). The flat
   importer's product-only `catalogue_import_source_links` is untouched. */

export const LINK_ENTITY_OF_SHEET: Record<string, TypedLinkEntity | undefined> = {
  Categories: "category",
  Products: "product",
  Variants: "variant",
  "Modifier Groups": "modifier_group",
  "Modifier Options": "modifier_option",
  Menus: "menu",
  "Menu Sections": "menu_section",
};

const TARGET_TABLE = {
  category: catalogueCategories,
  product: catalogueProducts,
  variant: catalogueVariants,
  modifier_group: catalogueModifierGroups,
  modifier_option: catalogueModifierOptions,
  menu: catalogueMenus,
  menu_section: catalogueMenuSections,
} as const;

async function targetExists(tx: DbTransaction, tenantId: string, entityType: TypedLinkEntity, publicId: string) {
  const table = TARGET_TABLE[entityType];
  const [row] = await tx
    .select({ publicId: table.publicId })
    .from(table)
    .where(and(eq(table.tenantId, tenantId), eq(table.publicId, publicId)))
    .limit(1);
  return Boolean(row);
}

export async function findTypedLinks(tx: DbTransaction, tenantId: string, namespace: string) {
  return tx
    .select()
    .from(workbookSourceLinks)
    .where(and(eq(workbookSourceLinks.tenantId, tenantId), eq(workbookSourceLinks.sourceNamespace, namespace)));
}

/**
 * Links a workbook key to the record a unit just saved (created or updated). A link left
 * behind by a record that no longer exists is repointed (the review already
 * treated it as no link); a live link to another record is never moved,
 * because the unique target index refuses a second key for one record.
 */
export async function writeTypedLinkInTx(
  tx: DbTransaction,
  input: {
    tenantId: string;
    namespace: string;
    sheet: string;
    sourceKey: string;
    targetPublicId: string;
    planId: string;
    applyId: string;
    subject: string;
  },
): Promise<AppliedLink | null> {
  const entityType = LINK_ENTITY_OF_SHEET[input.sheet];
  if (!entityType || !input.sourceKey) return null;
  const [existing] = await tx
    .select({ targetPublicId: workbookSourceLinks.targetPublicId })
    .from(workbookSourceLinks)
    .where(
      and(
        eq(workbookSourceLinks.tenantId, input.tenantId),
        eq(workbookSourceLinks.sourceNamespace, input.namespace),
        eq(workbookSourceLinks.entityType, entityType),
        eq(workbookSourceLinks.sourceKey, input.sourceKey),
      ),
    )
    .limit(1);
  if (existing && existing.targetPublicId !== input.targetPublicId && (await targetExists(tx, input.tenantId, entityType, existing.targetPublicId))) {
    throw new ApplyUnitError("conflict", "This workbook key is already linked to another record.", { reason: "key_linked_elsewhere" });
  }
  const now = new Date();
  await tx
    .insert(workbookSourceLinks)
    .values({
      tenantId: input.tenantId,
      sourceNamespace: input.namespace,
      entityType,
      sourceKey: input.sourceKey,
      targetPublicId: input.targetPublicId,
      planId: input.planId,
      applyId: input.applyId,
      createdBySubject: input.subject,
    })
    .onConflictDoUpdate({
      target: [workbookSourceLinks.tenantId, workbookSourceLinks.sourceNamespace, workbookSourceLinks.entityType, workbookSourceLinks.sourceKey],
      set: { targetPublicId: input.targetPublicId, planId: input.planId, applyId: input.applyId, updatedAt: now },
    });
  return { namespace: input.namespace, entityType, sourceKey: input.sourceKey, targetPublicId: input.targetPublicId };
}
