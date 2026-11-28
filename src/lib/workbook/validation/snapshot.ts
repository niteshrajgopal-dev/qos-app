import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { catalogueImportSourceLinks, catalogueProducts, locations, tenants, workbookSourceLinks } from "@/db/schema";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { loadBranchContext } from "@/lib/staff/branch-context";
import { withTenantContext } from "@/lib/tenant/context";
import { contractSheet, SUPPORTED_ENTITY_SHEETS, type SupportedEntitySheet } from "@/lib/workbook/contract";
import { loadCurrentRecordExport } from "@/lib/workbook/export";

/* The tenant's current records for review (QOS-194, plan section 2.3). Read
   only, inside the tenant context (RLS): the export's own rows, in the
   export's column vocabulary with its revision tokens, so a review compares
   like with like. Categories and modifier groups are tenant-wide; products
   and menus belong to the brand; branch rows are the permitted ones. The
   Phase 2 inventory and recipe records (QOS-200) are tenant-wide, warehouses
   at the permitted branches only. */

type Row = Record<string, string>;

export type BusinessProfile = "hospitality" | "generic_retail";

export type ReviewSnapshot = {
  tenantPublicId: string;
  brandPublicId: string;
  currency: string;
  businessProfile: BusinessProfile;
  /** Export rows per supported sheet, keyed by the sheet's QOS id column. */
  records: Record<SupportedEntitySheet, Map<string, Row>>;
  /** Branches the caller may work in for this review, with their names. */
  permittedBranches: Map<string, string>;
  /** Every location of the tenant, to tell "not permitted" from "unknown". */
  allBranchPublicIds: Set<string>;
  /** `catalogue_import_source_links` for the review namespace: workbook key → product public id. */
  sourceLinks: Map<string, string>;
  /** Typed workbook source links (QOS-217) for the review namespace: sheet → workbook key → public id of an existing record. */
  typedLinks: Map<string, Map<string, string>>;
  /** The plan that last wrote each typed link (same sheet → key index), or null when unknown. Never part of the snapshot hash. */
  typedLinkOrigins: Map<string, Map<string, string | null>>;
  branchScope: "all" | string[];
  exportRevision: string;
  snapshotHash: string;
};

export type SnapshotSource = {
  tenantPublicId: string;
  brandPublicId: string;
  currency: string;
  businessProfile: BusinessProfile;
  records: Partial<Record<SupportedEntitySheet, Row[]>>;
  permittedBranches: Array<{ publicId: string; name: string }>;
  allBranchPublicIds: string[];
  sourceLinks?: Array<{ sourceId: string; productPublicId: string }>;
  /** Typed workbook source links (QOS-217) for the namespace. */
  typedLinks?: TypedSourceLink[];
  branchScope?: "all" | string[];
  exportRevision?: string;
};

export type TypedSourceLink = { entityType: string; sourceKey: string; targetPublicId: string; planId?: string | null };

/** Entity sheet of each typed link entity type (QOS-217, decision D-LINKS; QOS-200 adds the Phase 2 entities). */
export const TYPED_LINK_SHEETS: Record<string, SupportedEntitySheet> = {
  category: "Categories",
  product: "Products",
  variant: "Variants",
  modifier_group: "Modifier Groups",
  modifier_option: "Modifier Options",
  menu: "Menus",
  menu_section: "Menu Sections",
  unit: "Units",
  supplier: "Suppliers",
  warehouse: "Warehouses",
  inventory_category: "Inventory Categories",
  inventory_item: "Ingredients",
  recipe_version: "Recipes",
  recipe_line: "Recipe Lines",
  prep_step: "Prep Steps",
  modifier_effect: "Modifier Effects",
};

/**
 * Recipe families have no sheet of their own: a `recipe` typed link maps a
 * Recipes row's `recipe_key` to the family public id, and is live while some
 * exported version belongs to that family. Indexed under this pseudo-sheet.
 */
export const RECIPE_FAMILY_LINKS = "Recipes:recipe_key";

function linkTargetExists(source: Pick<SnapshotSource, "records">, link: TypedSourceLink) {
  if (link.entityType === "recipe") {
    return (source.records.Recipes ?? []).some((row) => row.recipe_key === link.targetPublicId);
  }
  const sheet = TYPED_LINK_SHEETS[link.entityType];
  if (!sheet) return false;
  const idColumn = idColumnOf(sheet);
  return (source.records[sheet] ?? []).some((row) => row[idColumn] === link.targetPublicId);
}

/** QOS id column of a supported sheet (`qos_product_id`, `qos_location_id`, …). */
export function idColumnOf(sheet: string) {
  return contractSheet(sheet).columns[1]!.key;
}

export function keyColumnOf(sheet: string) {
  return contractSheet(sheet).columns[0]!.key;
}

/**
 * Typed links whose target is one of the snapshot's records. A link to a
 * record that no longer exists (or belongs to another brand) is no link.
 */
export function liveTypedLinks(source: Pick<SnapshotSource, "records" | "typedLinks">) {
  return (source.typedLinks ?? []).filter((link) => linkTargetExists(source, link));
}

export function snapshotHashOf(source: Pick<SnapshotSource, "records" | "permittedBranches" | "brandPublicId" | "sourceLinks" | "typedLinks">) {
  const tokens = SUPPORTED_ENTITY_SHEETS.flatMap((sheet) => (source.records[sheet] ?? []).map((row) => row.expected_revision ?? "")).sort();
  const branches = source.permittedBranches.map((branch) => branch.publicId).sort();
  const links = (source.sourceLinks ?? []).map((link) => `${link.sourceId}\u0000${link.productPublicId}`).sort();
  const typed = liveTypedLinks(source)
    .map((link) => `${link.entityType}\u0000${link.sourceKey}\u0000${link.targetPublicId}`)
    .sort();
  return createHash("sha256")
    .update(JSON.stringify({ tokens, branches, brand: source.brandPublicId, links, typed }))
    .digest("hex");
}

/** Builds the in-memory snapshot. Pure, so review rules are tested without a database. */
export function buildReviewSnapshot(source: SnapshotSource): ReviewSnapshot {
  const records = Object.fromEntries(
    SUPPORTED_ENTITY_SHEETS.map((sheet) => {
      const idColumn = idColumnOf(sheet);
      return [sheet, new Map((source.records[sheet] ?? []).map((row) => [row[idColumn]!, row]))];
    }),
  ) as ReviewSnapshot["records"];
  return {
    tenantPublicId: source.tenantPublicId,
    brandPublicId: source.brandPublicId,
    currency: source.currency,
    businessProfile: source.businessProfile,
    records,
    permittedBranches: new Map(source.permittedBranches.map((branch) => [branch.publicId, branch.name])),
    allBranchPublicIds: new Set(source.allBranchPublicIds),
    sourceLinks: new Map((source.sourceLinks ?? []).map((link) => [link.sourceId, link.productPublicId])),
    typedLinks: typedLinkIndex(liveTypedLinks(source)),
    typedLinkOrigins: typedLinkOriginIndex(liveTypedLinks(source)),
    branchScope: source.branchScope ?? "all",
    exportRevision: source.exportRevision ?? "",
    snapshotHash: snapshotHashOf(source),
  };
}

function linkSheetOf(link: TypedSourceLink) {
  return link.entityType === "recipe" ? RECIPE_FAMILY_LINKS : TYPED_LINK_SHEETS[link.entityType]!;
}

function typedLinkIndex(links: TypedSourceLink[]) {
  const index = new Map<string, Map<string, string>>();
  for (const link of links) {
    const sheet = linkSheetOf(link);
    const bySheet = index.get(sheet) ?? new Map<string, string>();
    bySheet.set(link.sourceKey, link.targetPublicId);
    index.set(sheet, bySheet);
  }
  return index;
}

function typedLinkOriginIndex(links: TypedSourceLink[]) {
  const index = new Map<string, Map<string, string | null>>();
  for (const link of links) {
    const sheet = linkSheetOf(link);
    const bySheet = index.get(sheet) ?? new Map<string, string | null>();
    bySheet.set(link.sourceKey, link.planId ?? null);
    index.set(sheet, bySheet);
  }
  return index;
}

/**
 * Loads the snapshot for one brand and the caller's branch scope. A `branch`
 * narrows the scope to one permitted branch (403 otherwise, as the export
 * does); it never widens it. Source links are read for the review namespace
 * only: the flat importer's product links, and the typed links a workbook
 * apply writes (QOS-217) for every entity sheet.
 */
export async function loadReviewSnapshot(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  options: { brand: string; branch?: string | null; sourceNamespace: string },
): Promise<ReviewSnapshot> {
  return buildReviewSnapshot(await loadSnapshotSource(db, tenantId, membership, options));
}

const BRANCH_COLUMN: Partial<Record<SupportedEntitySheet, string>> = {
  Branches: "qos_location_id",
  "Branch Prices": "branch_key",
  "Menu Branches": "branch_key",
  Warehouses: "branch_key",
};

/**
 * The same records seen through a plan's branch scope, so staleness is judged
 * on what the plan compared against. Null when the viewer cannot see every
 * branch of that scope (the plan is then neither confirmed nor marked stale).
 */
export function restrictSourceToScope(source: SnapshotSource, scope: "all" | string[]): SnapshotSource | null {
  const current = source.branchScope ?? "all";
  if (scope === "all") return current === "all" ? source : null;
  const permitted = new Set(source.permittedBranches.map((branch) => branch.publicId));
  if (!scope.every((publicId) => permitted.has(publicId))) return null;
  const inScope = new Set(scope);
  const records = Object.fromEntries(
    Object.entries(source.records).map(([sheet, rows]) => {
      const column = BRANCH_COLUMN[sheet as SupportedEntitySheet];
      return [sheet, column ? (rows ?? []).filter((row) => inScope.has(row[column] ?? "")) : rows];
    }),
  ) as SnapshotSource["records"];
  return {
    ...source,
    records,
    permittedBranches: source.permittedBranches.filter((branch) => inScope.has(branch.publicId)),
    branchScope: [...scope].sort(),
  };
}

export async function loadSnapshotSource(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  options: { brand: string; branch?: string | null; sourceNamespace: string },
): Promise<SnapshotSource> {
  const data = await loadCurrentRecordExport(db, tenantId, membership, { brand: options.brand, branch: options.branch });
  const branchContext = await loadBranchContext(db, tenantId, membership);
  const narrowed = options.branch?.trim();
  const permitted = branchContext.branches.filter((branch) => !narrowed || branch.publicId === narrowed);

  const extra = await withTenantContext(db, tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ businessProfile: tenants.businessProfile })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const allLocations = await tx.select({ publicId: locations.publicId }).from(locations).where(eq(locations.tenantId, tenantId));
    const links = await tx
      .select({ sourceId: catalogueImportSourceLinks.sourceId, productPublicId: catalogueProducts.publicId })
      .from(catalogueImportSourceLinks)
      .innerJoin(
        catalogueProducts,
        and(eq(catalogueProducts.tenantId, catalogueImportSourceLinks.tenantId), eq(catalogueProducts.id, catalogueImportSourceLinks.productId)),
      )
      .where(and(eq(catalogueImportSourceLinks.tenantId, tenantId), eq(catalogueImportSourceLinks.connectionKey, options.sourceNamespace)));
    const typedLinks = await tx
      .select({
        entityType: workbookSourceLinks.entityType,
        sourceKey: workbookSourceLinks.sourceKey,
        targetPublicId: workbookSourceLinks.targetPublicId,
        planId: workbookSourceLinks.planId,
      })
      .from(workbookSourceLinks)
      .where(and(eq(workbookSourceLinks.tenantId, tenantId), eq(workbookSourceLinks.sourceNamespace, options.sourceNamespace)));
    return { businessProfile: tenant?.businessProfile ?? "hospitality", allLocations, links, typedLinks };
  });

  return {
    tenantPublicId: data.manifest.tenant_public_id,
    brandPublicId: data.manifest.brand_public_id,
    currency: data.manifest.pilot_currency,
    businessProfile: extra.businessProfile,
    records: data.records,
    permittedBranches: permitted.map((branch) => ({ publicId: branch.publicId, name: branch.name })),
    allBranchPublicIds: extra.allLocations.map((row) => row.publicId),
    sourceLinks: extra.links,
    typedLinks: extra.typedLinks,
    branchScope:
      membership.role === "administrator" && !narrowed ? "all" : permitted.map((branch) => branch.publicId).sort(),
    exportRevision: data.manifest.export_revision,
  };
}
