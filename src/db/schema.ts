import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { pgSchema } from "drizzle-orm/pg-core";

import type {
  PlanAcknowledgement,
  PlanStatus,
  ReviewChange,
  ReviewClassification,
  ReviewCounts,
  ReviewDeferredField,
  ReviewDependencies,
  ReviewDiagnostic,
  ReviewOperation,
  ReviewProvenance,
  ReviewRowDetail,
  ReviewSourceProfile,
  RowDecision,
  StoredPlanContext,
} from "@/lib/workbook/validation/model";
import type {
  ApplyCounts,
  ApplyFailure,
  ApplyStatus,
  ApplySummary,
  RowApplyResult,
  RowApplyState,
  TypedLinkEntity,
} from "@/lib/workbook/apply/model";

export const qos = pgSchema("qos");

export const tenantStatusEnum = qos.enum("tenant_status", [
  "active",
  "suspended",
]);

export const businessProfileEnum = qos.enum("business_profile", [
  "hospitality",
  "generic_retail",
]);

export const locationStatusEnum = qos.enum("location_status", [
  "active",
  "suspended",
]);

export const staffRoleEnum = qos.enum("staff_role", [
  "administrator",
  "user",
]);

export const membershipStatusEnum = qos.enum("membership_status", [
  "active",
  "revoked",
]);

export const invitationStatusEnum = qos.enum("invitation_status", [
  "pending",
  "accepted",
  "revoked",
  "expired",
]);

export const invitationDeliveryStatusEnum = qos.enum(
  "invitation_delivery_status",
  ["pending", "failed", "sent"],
);

export const provisioningOperationStatusEnum = qos.enum(
  "provisioning_operation_status",
  ["pending", "completed", "failed"],
);

export const accessRequestStatusEnum = qos.enum("access_request_status", [
  "pending",
  "approved",
  "rejected",
]);

export const dataProvenanceEnum = qos.enum("data_provenance", [
  "synthetic_fixture",
  "operator_entered",
  "imported",
  "ai_generated",
]);

export const auditActorClassEnum = qos.enum("audit_actor_class", [
  "staff_administrator",
  "staff_user",
  "operator",
  "system",
]);

export const externalMenuProviderEnum = qos.enum("external_menu_provider", [
  "finedine",
]);

export const productStatusEnum = qos.enum("product_status", [
  "draft",
  "active",
  "archived",
]);

export const translationApprovalStatusEnum = qos.enum(
  "translation_approval_status",
  ["draft", "approved", "rejected"],
);

export const catalogueStopSaleTargetTypeEnum = qos.enum(
  "catalogue_stop_sale_target_type",
  ["product", "variant", "modifier_option"],
);

export const tenants = qos.table(
  "tenants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: text("public_id").notNull(),
    name: text("name").notNull(),
    status: tenantStatusEnum("status").notNull().default("active"),
    businessProfile: businessProfileEnum("business_profile").notNull(),
    baseCurrency: char("base_currency", { length: 3 }).notNull(),
    defaultLocale: text("default_locale").notNull(),
    defaultTimezone: text("default_timezone").notNull(),
    supportedLocales: text("supported_locales").array().notNull(),
    provisionedByOperatorId: text("provisioned_by_operator_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("tenants_public_id_unique").on(table.publicId),
    index("tenants_status_idx").on(table.status),
  ],
);

export const organizations = qos.table(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    publicId: text("public_id").notNull(),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("organizations_tenant_public_id_unique").on(
      table.tenantId,
      table.publicId,
    ),
    unique("organizations_tenant_id_id_unique").on(table.tenantId, table.id),
    index("organizations_tenant_id_idx").on(table.tenantId),
  ],
);

export const brands = qos.table(
  "brands",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    publicId: text("public_id").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizations.tenantId, organizations.id],
    }).onDelete("restrict"),
    unique("brands_tenant_public_id_unique").on(table.tenantId, table.publicId),
    unique("brands_tenant_id_id_unique").on(table.tenantId, table.id),
    index("brands_tenant_id_idx").on(table.tenantId),
  ],
);

export const locations = qos.table(
  "locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    brandId: uuid("brand_id").notNull(),
    publicId: text("public_id").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    timezone: text("timezone").notNull(),
    status: locationStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.brandId],
      foreignColumns: [brands.tenantId, brands.id],
    }).onDelete("restrict"),
    unique("locations_tenant_public_id_unique").on(
      table.tenantId,
      table.publicId,
    ),
    unique("locations_tenant_slug_unique").on(table.tenantId, table.slug),
    unique("locations_tenant_id_id_unique").on(table.tenantId, table.id),
    index("locations_tenant_id_idx").on(table.tenantId),
  ],
);

export const staffIdentities = qos.table(
  "staff_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerSubject: text("provider_subject").notNull(),
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("staff_identities_provider_subject_unique").on(table.providerSubject),
    unique("staff_identities_email_unique").on(table.email),
  ],
);

export const staffMemberships = qos.table(
  "staff_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    staffIdentityId: uuid("staff_identity_id")
      .notNull()
      .references(() => staffIdentities.id, { onDelete: "restrict" }),
    role: staffRoleEnum("role").notNull(),
    status: membershipStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("staff_memberships_tenant_staff_unique").on(
      table.tenantId,
      table.staffIdentityId,
    ),
    unique("staff_memberships_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    index("staff_memberships_tenant_id_idx").on(table.tenantId),
  ],
);

export const staffInvitations = qos.table(
  "staff_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    role: staffRoleEnum("role").notNull(),
    status: invitationStatusEnum("status").notNull().default("pending"),
    deliveryStatus: invitationDeliveryStatusEnum("delivery_status")
      .notNull()
      .default("pending"),
    invitedByOperatorId: text("invited_by_operator_id").notNull(),
    tokenHash: text("token_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByStaffIdentityId: uuid("accepted_by_staff_identity_id").references(
      () => staffIdentities.id,
      { onDelete: "restrict" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("staff_invitations_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    index("staff_invitations_tenant_id_idx").on(table.tenantId),
    index("staff_invitations_email_idx").on(table.email),
    unique("staff_invitations_token_hash_unique").on(table.tokenHash),
  ],
);

export const staffInvitationLocations = qos.table(
  "staff_invitation_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    invitationId: uuid("invitation_id").notNull(),
    locationId: uuid("location_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.invitationId],
      foreignColumns: [staffInvitations.tenantId, staffInvitations.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [locations.tenantId, locations.id],
    }).onDelete("restrict"),
    unique("staff_invitation_locations_unique").on(
      table.invitationId,
      table.locationId,
    ),
    index("staff_invitation_locations_tenant_id_idx").on(table.tenantId),
  ],
);

export const locationWeeklyScheduleWindows = qos.table(
  "location_weekly_schedule_windows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    locationId: uuid("location_id").notNull(),
    dayOfWeek: integer("day_of_week").notNull(),
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [locations.tenantId, locations.id],
    }).onDelete("restrict"),
    index("location_weekly_schedule_windows_tenant_id_idx").on(table.tenantId),
    index("location_weekly_schedule_windows_location_idx").on(
      table.tenantId,
      table.locationId,
    ),
  ],
);

export const locationScheduleExceptions = qos.table(
  "location_schedule_exceptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    locationId: uuid("location_id").notNull(),
    exceptionDate: text("exception_date").notNull(),
    closedAllDay: boolean("closed_all_day").notNull().default(true),
    startMinute: integer("start_minute"),
    endMinute: integer("end_minute"),
    priority: integer("priority").notNull().default(0),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [locations.tenantId, locations.id],
    }).onDelete("restrict"),
    unique("location_schedule_exceptions_unique").on(
      table.tenantId,
      table.locationId,
      table.exceptionDate,
      table.priority,
    ),
    index("location_schedule_exceptions_tenant_id_idx").on(table.tenantId),
  ],
);

export const locationItemStopSales = qos.table(
  "location_item_stop_sales",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    locationId: uuid("location_id").notNull(),
    targetType: catalogueStopSaleTargetTypeEnum("target_type").notNull(),
    targetPublicId: text("target_public_id").notNull(),
    reason: text("reason").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBySubject: text("created_by_subject").notNull(),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
    clearedBySubject: text("cleared_by_subject"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [locations.tenantId, locations.id],
    }).onDelete("restrict"),
    index("location_item_stop_sales_tenant_id_idx").on(table.tenantId),
    index("location_item_stop_sales_lookup_idx").on(
      table.tenantId,
      table.locationId,
      table.targetType,
      table.targetPublicId,
    ),
  ],
);

export const locationExternalMenuSources = qos.table(
  "location_external_menu_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    locationId: uuid("location_id").notNull(),
    provider: externalMenuProviderEnum("provider").notNull(),
    externalMenuId: text("external_menu_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    provenanceNote: text("provenance_note").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [locations.tenantId, locations.id],
    }).onDelete("restrict"),
    unique("location_external_menu_sources_unique").on(
      table.tenantId,
      table.locationId,
      table.provider,
    ),
    index("location_external_menu_sources_tenant_id_idx").on(table.tenantId),
  ],
);

export const catalogueProducts = qos.table(
  "catalogue_products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    brandId: uuid("brand_id").notNull(),
    publicId: text("public_id").notNull(),
    internalName: text("internal_name").notNull(),
    status: productStatusEnum("status").notNull().default("draft"),
    provenance: dataProvenanceEnum("provenance").notNull(),
    version: integer("version").notNull().default(1),
    sku: text("sku"),
    barcode: text("barcode"),
    primaryMediaAssetId: uuid("primary_media_asset_id"),
    nutritionCalories: integer("nutrition_calories"),
    // QOS-214: null is unknown; 0 is a declared value.
    preparationTimeMinutes: integer("preparation_time_minutes"),
    walkingTimeMinutes: integer("walking_time_minutes"),
    highSalt: boolean("high_salt"),
    // Recorded stock-product intent only. It never creates an inventory item,
    // recipe or stock deduction (see lib/catalogue/selling-attributes.ts).
    directStockIntent: boolean("direct_stock_intent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.brandId],
      foreignColumns: [brands.tenantId, brands.id],
    }).onDelete("restrict"),
    check(
      "catalogue_products_preparation_time_minutes_check",
      sql`${table.preparationTimeMinutes} IS NULL OR ${table.preparationTimeMinutes} >= 0`,
    ),
    check(
      "catalogue_products_walking_time_minutes_check",
      sql`${table.walkingTimeMinutes} IS NULL OR ${table.walkingTimeMinutes} >= 0`,
    ),
    unique("catalogue_products_tenant_public_id_unique").on(
      table.tenantId,
      table.publicId,
    ),
    unique("catalogue_products_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    index("catalogue_products_tenant_id_idx").on(table.tenantId),
  ],
);

export const catalogueProductTranslations = qos.table(
  "catalogue_product_translations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    productId: uuid("product_id").notNull(),
    locale: text("locale").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    translationVersion: integer("translation_version").notNull().default(1),
    approvalStatus: translationApprovalStatusEnum("approval_status")
      .notNull()
      .default("draft"),
    provenance: dataProvenanceEnum("provenance")
      .notNull()
      .default("operator_entered"),
    approvedBySubject: text("approved_by_subject"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedTranslationVersion: integer("approved_translation_version"),
    approvedSourceTranslationVersion: integer(
      "approved_source_translation_version",
    ),
    lastApprovedBySubject: text("last_approved_by_subject"),
    lastApprovedAt: timestamp("last_approved_at", { withTimezone: true }),
    lastApprovedTranslationVersion: integer("last_approved_translation_version"),
    lastApprovedSourceTranslationVersion: integer(
      "last_approved_source_translation_version",
    ),
    lastApprovedDisplayName: text("last_approved_display_name"),
    lastApprovedDescription: text("last_approved_description"),
    adminReviewRevertDisplayName: text("admin_review_revert_display_name"),
    adminReviewRevertDescription: text("admin_review_revert_description"),
    adminReviewRevertProvenance: dataProvenanceEnum("admin_review_revert_provenance"),
    adminReviewRevertApprovalStatus: translationApprovalStatusEnum(
      "admin_review_revert_approval_status",
    ),
    adminReviewRevertApprovedBySubject: text(
      "admin_review_revert_approved_by_subject",
    ),
    adminReviewRevertApprovedAt: timestamp("admin_review_revert_approved_at", {
      withTimezone: true,
    }),
    adminReviewRevertApprovedTranslationVersion: integer(
      "admin_review_revert_approved_translation_version",
    ),
    adminReviewRevertApprovedSourceTranslationVersion: integer(
      "admin_review_revert_approved_source_translation_version",
    ),
    adminReviewRevertCapturesApprovalFields: boolean(
      "admin_review_revert_captures_approval_fields",
    )
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [catalogueProducts.tenantId, catalogueProducts.id],
    }).onDelete("restrict"),
    unique("catalogue_product_translations_unique").on(
      table.tenantId,
      table.productId,
      table.locale,
    ),
    index("catalogue_product_translations_tenant_id_idx").on(table.tenantId),
  ],
);

export const catalogueVariants = qos.table(
  "catalogue_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    productId: uuid("product_id").notNull(),
    publicId: text("public_id").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    status: productStatusEnum("status").notNull().default("active"),
    sku: text("sku"),
    barcode: text("barcode"),
    // QOS-214: null is undeclared, never "per piece".
    sellingQuantityBasis: text("selling_quantity_basis"),
    priceUnit: text("price_unit"),
    priceUnitQuantity: numeric("price_unit_quantity", { mode: "number" }),
    /** QOS-215: how the selling price treats tax. NULL = not recorded. */
    priceTaxBasis: text("price_tax_basis").$type<
      "inclusive" | "exclusive" | "unconfirmed"
    >(),
    /** QOS-215: exact tax rate in basis points (500 = 5%). 0 is a real 0% rate; NULL = not recorded. */
    taxRateBasisPoints: integer("tax_rate_basis_points"),
    taxProvenance: dataProvenanceEnum("tax_provenance"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [catalogueProducts.tenantId, catalogueProducts.id],
    }).onDelete("restrict"),
    check(
      "catalogue_variants_selling_quantity_basis_check",
      sql`${table.sellingQuantityBasis} IS NULL OR ${table.sellingQuantityBasis} IN ('each', 'weight')`,
    ),
    check(
      "catalogue_variants_price_unit_check",
      sql`${table.priceUnit} IS NULL OR ${table.priceUnit} IN ('each', 'kg', 'g')`,
    ),
    check(
      "catalogue_variants_price_unit_quantity_check",
      sql`${table.priceUnitQuantity} IS NULL OR ${table.priceUnitQuantity} > 0`,
    ),
    check(
      "catalogue_variants_price_tax_basis_check",
      sql`${table.priceTaxBasis} IS NULL OR ${table.priceTaxBasis} IN ('inclusive', 'exclusive', 'unconfirmed')`,
    ),
    check(
      "catalogue_variants_tax_rate_basis_points_check",
      sql`${table.taxRateBasisPoints} IS NULL OR ${table.taxRateBasisPoints} >= 0`,
    ),
    unique("catalogue_variants_tenant_public_id_unique").on(
      table.tenantId,
      table.publicId,
    ),
    unique("catalogue_variants_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    index("catalogue_variants_tenant_id_idx").on(table.tenantId),
  ],
);

export const catalogueVariantTranslations = qos.table(
  "catalogue_variant_translations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    locale: text("locale").notNull(),
    displayName: text("display_name").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.variantId],
      foreignColumns: [catalogueVariants.tenantId, catalogueVariants.id],
    }).onDelete("restrict"),
    unique("catalogue_variant_translations_unique").on(
      table.tenantId,
      table.variantId,
      table.locale,
    ),
    index("catalogue_variant_translations_tenant_id_idx").on(table.tenantId),
  ],
);

export const catalogueVariantPrices = qos.table(
  "catalogue_variant_prices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    amountMinor: integer("amount_minor").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.variantId],
      foreignColumns: [catalogueVariants.tenantId, catalogueVariants.id],
    }).onDelete("restrict"),
    unique("catalogue_variant_prices_unique").on(
      table.tenantId,
      table.variantId,
      table.currency,
    ),
    index("catalogue_variant_prices_tenant_id_idx").on(table.tenantId),
  ],
);

export const catalogueVariantLocationPriceOverrides = qos.table(
  "catalogue_variant_location_price_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    locationId: uuid("location_id").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    amountMinor: integer("amount_minor").notNull(),
    centralPriceVersionAtOverride: integer(
      "central_price_version_at_override",
    ).notNull(),
    createdBySubject: text("created_by_subject").notNull(),
    updatedBySubject: text("updated_by_subject").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.variantId],
      foreignColumns: [catalogueVariants.tenantId, catalogueVariants.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [locations.tenantId, locations.id],
    }).onDelete("restrict"),
    unique("catalogue_variant_location_price_overrides_unique").on(
      table.tenantId,
      table.variantId,
      table.locationId,
      table.currency,
    ),
    index("catalogue_variant_location_price_overrides_tenant_id_idx").on(
      table.tenantId,
    ),
  ],
);

export const catalogueVariantLocationPriceResetAudits = qos.table(
  "catalogue_variant_location_price_reset_audits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    locationId: uuid("location_id").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    previousAmountMinor: integer("previous_amount_minor").notNull(),
    resetBySubject: text("reset_by_subject").notNull(),
    resetAt: timestamp("reset_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.variantId],
      foreignColumns: [catalogueVariants.tenantId, catalogueVariants.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [locations.tenantId, locations.id],
    }).onDelete("restrict"),
    index("catalogue_variant_location_price_reset_audits_tenant_id_idx").on(
      table.tenantId,
    ),
  ],
);

export const catalogueModifierGroups = qos.table(
  "catalogue_modifier_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    publicId: text("public_id").notNull(),
    internalName: text("internal_name").notNull(),
    minSelections: integer("min_selections").notNull().default(0),
    maxSelections: integer("max_selections").notNull().default(1),
    version: integer("version").notNull().default(1),
    status: productStatusEnum("status").notNull().default("active"),
    provenance: dataProvenanceEnum("provenance").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("catalogue_modifier_groups_tenant_public_id_unique").on(
      table.tenantId,
      table.publicId,
    ),
    unique("catalogue_modifier_groups_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    index("catalogue_modifier_groups_tenant_id_idx").on(table.tenantId),
  ],
);

export const catalogueModifierGroupTranslations = qos.table(
  "catalogue_modifier_group_translations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    modifierGroupId: uuid("modifier_group_id").notNull(),
    locale: text("locale").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.modifierGroupId],
      foreignColumns: [
        catalogueModifierGroups.tenantId,
        catalogueModifierGroups.id,
      ],
    }).onDelete("restrict"),
    unique("catalogue_modifier_group_translations_unique").on(
      table.tenantId,
      table.modifierGroupId,
      table.locale,
    ),
    index("catalogue_modifier_group_translations_tenant_id_idx").on(
      table.tenantId,
    ),
  ],
);

export const catalogueModifierOptions = qos.table(
  "catalogue_modifier_options",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    modifierGroupId: uuid("modifier_group_id").notNull(),
    publicId: text("public_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isDefault: boolean("is_default").notNull().default(false),
    allowsQuantity: boolean("allows_quantity").notNull().default(false),
    maxQuantity: integer("max_quantity").notNull().default(1),
    status: productStatusEnum("status").notNull().default("active"),
    priceMinor: integer("price_minor").notNull().default(0),
    currency: char("currency", { length: 3 }).notNull().default("AED"),
    // QOS-214: whole kcal, same convention as catalogue_products.nutrition_calories.
    nutritionCalories: integer("nutrition_calories"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "catalogue_modifier_options_nutrition_calories_check",
      sql`${table.nutritionCalories} IS NULL OR ${table.nutritionCalories} >= 0`,
    ),
    foreignKey({
      columns: [table.tenantId, table.modifierGroupId],
      foreignColumns: [
        catalogueModifierGroups.tenantId,
        catalogueModifierGroups.id,
      ],
    }).onDelete("restrict"),
    unique("catalogue_modifier_options_tenant_public_id_unique").on(
      table.tenantId,
      table.publicId,
    ),
    unique("catalogue_modifier_options_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    index("catalogue_modifier_options_tenant_id_idx").on(table.tenantId),
  ],
);


/* QOS-215 reference-cost policies. Append-only and dated: a successor row
   closes the previous current row by setting effective_to; amounts are never
   rewritten (qos_app may UPDATE only effective_to). amount_micros is integer
   millionths of one major currency unit (1 AED = 1_000_000). */
function referenceCostPolicyColumns() {
  return {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    publicId: text("public_id").notNull(),
    method: text("method").notNull().$type<"manual" | "recipe_derived">(),
    amountMicros: bigint("amount_micros", { mode: "bigint" }),
    currency: char("currency", { length: 3 }),
    unit: text("unit").$type<"each" | "kg" | "g">(),
    taxBasis: text("tax_basis").$type<"net" | "gross" | "unconfirmed">(),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    source: text("source"),
    sourceReference: text("source_reference"),
    revision: integer("revision").notNull(),
    provenance: dataProvenanceEnum("provenance"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBySubject: text("created_by_subject"),
  };
}

function referenceCostPolicyChecks(
  prefix: string,
  table: {
    method: AnyPgColumn;
    amountMicros: AnyPgColumn;
    currency: AnyPgColumn;
    unit: AnyPgColumn;
    taxBasis: AnyPgColumn;
    effectiveFrom: AnyPgColumn;
    effectiveTo: AnyPgColumn;
    revision: AnyPgColumn;
  },
) {
  return [
    check(`${prefix}_method_check`, sql`${table.method} IN ('manual', 'recipe_derived')`),
    check(`${prefix}_amount_check`, sql`${table.amountMicros} IS NULL OR ${table.amountMicros} >= 0`),
    check(
      `${prefix}_method_amount_check`,
      sql`(${table.method} = 'manual' AND ${table.amountMicros} IS NOT NULL AND ${table.currency} IS NOT NULL AND ${table.effectiveFrom} IS NOT NULL) OR (${table.method} = 'recipe_derived' AND ${table.amountMicros} IS NULL)`,
    ),
    check(`${prefix}_currency_check`, sql`${table.currency} IS NULL OR ${table.currency} ~ '^[A-Z]{3}$'`),
    check(`${prefix}_unit_check`, sql`${table.unit} IS NULL OR ${table.unit} IN ('each', 'kg', 'g')`),
    check(
      `${prefix}_tax_basis_check`,
      sql`${table.taxBasis} IS NULL OR ${table.taxBasis} IN ('net', 'gross', 'unconfirmed')`,
    ),
    check(
      `${prefix}_dates_check`,
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveFrom} IS NULL OR ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
    check(`${prefix}_revision_check`, sql`${table.revision} >= 1`),
  ];
}

export const catalogueVariantReferenceCostPolicies = qos.table(
  "catalogue_variant_reference_cost_policies",
  {
    ...referenceCostPolicyColumns(),
    variantId: uuid("variant_id").notNull(),
  },
  (table) => [
    foreignKey({
      name: "catalogue_variant_ref_cost_variant_fk",
      columns: [table.tenantId, table.variantId],
      foreignColumns: [catalogueVariants.tenantId, catalogueVariants.id],
    }).onDelete("restrict"),
    unique("catalogue_variant_ref_cost_tenant_public_id_unique").on(
      table.tenantId,
      table.publicId,
    ),
    unique("catalogue_variant_ref_cost_revision_unique").on(
      table.tenantId,
      table.variantId,
      table.revision,
    ),
    uniqueIndex("catalogue_variant_ref_cost_current_unique")
      .on(table.tenantId, table.variantId)
      .where(sql`effective_to IS NULL`),
    index("catalogue_variant_ref_cost_tenant_id_idx").on(
      table.tenantId,
    ),
    ...referenceCostPolicyChecks("catalogue_variant_ref_cost", table),
  ],
);

export const catalogueModifierOptionTranslations = qos.table(
  "catalogue_modifier_option_translations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    modifierOptionId: uuid("modifier_option_id").notNull(),
    locale: text("locale").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.modifierOptionId],
      foreignColumns: [
        catalogueModifierOptions.tenantId,
        catalogueModifierOptions.id,
      ],
    }).onDelete("restrict"),
    unique("catalogue_modifier_option_translations_unique").on(
      table.tenantId,
      table.modifierOptionId,
      table.locale,
    ),
    index("catalogue_modifier_option_translations_tenant_id_idx").on(
      table.tenantId,
    ),
  ],
);


export const catalogueModifierOptionReferenceCostPolicies = qos.table(
  "catalogue_modifier_option_reference_cost_policies",
  {
    ...referenceCostPolicyColumns(),
    modifierOptionId: uuid("modifier_option_id").notNull(),
  },
  (table) => [
    foreignKey({
      name: "catalogue_option_ref_cost_option_fk",
      columns: [table.tenantId, table.modifierOptionId],
      foreignColumns: [
        catalogueModifierOptions.tenantId,
        catalogueModifierOptions.id,
      ],
    }).onDelete("restrict"),
    unique(
      "catalogue_option_ref_cost_tenant_public_id_unique",
    ).on(table.tenantId, table.publicId),
    unique("catalogue_option_ref_cost_revision_unique").on(
      table.tenantId,
      table.modifierOptionId,
      table.revision,
    ),
    uniqueIndex("catalogue_option_ref_cost_current_unique")
      .on(table.tenantId, table.modifierOptionId)
      .where(sql`effective_to IS NULL`),
    index("catalogue_option_ref_cost_tenant_id_idx").on(
      table.tenantId,
    ),
    ...referenceCostPolicyChecks("catalogue_option_ref_cost", table),
  ],
);

/* QOS-213: tenant sales-channel identities (aggregators and other channels)
   and their separate variant / modifier-option price lists. A channel is not
   a location: it has no branch, no stock and no storefront. Absence of a
   price row means "no explicit channel price" (inherit central); a row with
   amount_minor = 0 is a genuine zero price. Migration 0056. */
export const salesChannels = qos.table(
  "sales_channels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    publicId: text("public_id").notNull(),
    code: text("code").notNull(),
    displayName: text("display_name").notNull(),
    kind: text("kind").notNull().default("aggregator"),
    workbookSlot: text("workbook_slot"),
    status: text("status").notNull().default("active"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("sales_channels_tenant_public_id_unique").on(
      table.tenantId,
      table.publicId,
    ),
    unique("sales_channels_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("sales_channels_tenant_code_unique").on(table.tenantId, table.code),
    uniqueIndex("sales_channels_tenant_workbook_slot_unique")
      .on(table.tenantId, table.workbookSlot)
      .where(sql`"workbook_slot" IS NOT NULL`),
    check(
      "sales_channels_public_id_format",
      sql`${table.publicId} ~ '^schan_[a-z0-9_-]+$'`,
    ),
    check(
      "sales_channels_code_format",
      sql`${table.code} ~ '^[a-z0-9_]+$' AND char_length(${table.code}) <= 64`,
    ),
    check(
      "sales_channels_display_name_len",
      sql`char_length(btrim(${table.displayName})) BETWEEN 1 AND 120`,
    ),
    check("sales_channels_kind_check", sql`${table.kind} IN ('aggregator', 'other')`),
    check(
      "sales_channels_workbook_slot_check",
      sql`${table.workbookSlot} IS NULL OR ${table.workbookSlot} IN ('aggregator_1', 'aggregator_2', 'aggregator_3')`,
    ),
    check("sales_channels_status_check", sql`${table.status} IN ('active', 'archived')`),
    check("sales_channels_version_check", sql`${table.version} >= 1`),
    index("sales_channels_tenant_id_idx").on(table.tenantId),
  ],
);

export const catalogueVariantChannelPrices = qos.table(
  "catalogue_variant_channel_prices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    channelId: uuid("channel_id").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    amountMinor: integer("amount_minor").notNull(),
    version: integer("version").notNull().default(1),
    centralPriceVersionAtOverride: integer(
      "central_price_version_at_override",
    ).notNull(),
    createdBySubject: text("created_by_subject").notNull(),
    updatedBySubject: text("updated_by_subject").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "catalogue_variant_channel_prices_variant_fk",
      columns: [table.tenantId, table.variantId],
      foreignColumns: [catalogueVariants.tenantId, catalogueVariants.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "catalogue_variant_channel_prices_channel_fk",
      columns: [table.tenantId, table.channelId],
      foreignColumns: [salesChannels.tenantId, salesChannels.id],
    }).onDelete("restrict"),
    unique("catalogue_variant_channel_prices_unique").on(
      table.tenantId,
      table.variantId,
      table.channelId,
      table.currency,
    ),
    check(
      "catalogue_variant_channel_prices_amount_check",
      sql`${table.amountMinor} >= 0`,
    ),
    check(
      "catalogue_variant_channel_prices_version_check",
      sql`${table.version} >= 1`,
    ),
    index("catalogue_variant_channel_prices_tenant_id_idx").on(table.tenantId),
  ],
);

export const catalogueModifierOptionChannelPrices = qos.table(
  "catalogue_modifier_option_channel_prices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    modifierOptionId: uuid("modifier_option_id").notNull(),
    channelId: uuid("channel_id").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    amountMinor: integer("amount_minor").notNull(),
    version: integer("version").notNull().default(1),
    createdBySubject: text("created_by_subject").notNull(),
    updatedBySubject: text("updated_by_subject").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "catalogue_modifier_option_channel_prices_option_fk",
      columns: [table.tenantId, table.modifierOptionId],
      foreignColumns: [
        catalogueModifierOptions.tenantId,
        catalogueModifierOptions.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "catalogue_modifier_option_channel_prices_channel_fk",
      columns: [table.tenantId, table.channelId],
      foreignColumns: [salesChannels.tenantId, salesChannels.id],
    }).onDelete("restrict"),
    unique("catalogue_modifier_option_channel_prices_unique").on(
      table.tenantId,
      table.modifierOptionId,
      table.channelId,
      table.currency,
    ),
    check(
      "catalogue_modifier_option_channel_prices_amount_check",
      sql`${table.amountMinor} >= 0`,
    ),
    check(
      "catalogue_modifier_option_channel_prices_version_check",
      sql`${table.version} >= 1`,
    ),
    index("catalogue_modifier_option_channel_prices_tenant_id_idx").on(
      table.tenantId,
    ),
  ],
);

export const catalogueVariantChannelPriceResetAudits = qos.table(
  "catalogue_variant_channel_price_reset_audits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    channelId: uuid("channel_id").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    previousAmountMinor: integer("previous_amount_minor").notNull(),
    resetBySubject: text("reset_by_subject").notNull(),
    resetAt: timestamp("reset_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "catalogue_variant_channel_price_reset_audits_variant_fk",
      columns: [table.tenantId, table.variantId],
      foreignColumns: [catalogueVariants.tenantId, catalogueVariants.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "catalogue_variant_channel_price_reset_audits_channel_fk",
      columns: [table.tenantId, table.channelId],
      foreignColumns: [salesChannels.tenantId, salesChannels.id],
    }).onDelete("restrict"),
    index("catalogue_variant_channel_price_reset_audits_tenant_id_idx").on(
      table.tenantId,
    ),
  ],
);

export const catalogueModifierOptionChannelPriceResetAudits = qos.table(
  "catalogue_option_channel_price_reset_audits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    modifierOptionId: uuid("modifier_option_id").notNull(),
    channelId: uuid("channel_id").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    previousAmountMinor: integer("previous_amount_minor").notNull(),
    resetBySubject: text("reset_by_subject").notNull(),
    resetAt: timestamp("reset_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "catalogue_option_channel_price_reset_audits_option_fk",
      columns: [table.tenantId, table.modifierOptionId],
      foreignColumns: [
        catalogueModifierOptions.tenantId,
        catalogueModifierOptions.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "catalogue_option_channel_price_reset_audits_channel_fk",
      columns: [table.tenantId, table.channelId],
      foreignColumns: [salesChannels.tenantId, salesChannels.id],
    }).onDelete("restrict"),
    index(
      "catalogue_option_channel_price_reset_audits_tenant_id_idx",
    ).on(table.tenantId),
  ],
);

export const catalogueProductModifierGroups = qos.table(
  "catalogue_product_modifier_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    productId: uuid("product_id").notNull(),
    modifierGroupId: uuid("modifier_group_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    // QOS-212 assignment policy overrides. Null inherits the group bounds and
    // the option repeat limits; see src/lib/catalogue/modifier-assignment-policy.ts.
    minSelections: integer("min_selections"),
    maxSelections: integer("max_selections"),
    repeatAllowed: boolean("repeat_allowed"),
    selectionCountMode: text("selection_count_mode"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [catalogueProducts.tenantId, catalogueProducts.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.modifierGroupId],
      foreignColumns: [
        catalogueModifierGroups.tenantId,
        catalogueModifierGroups.id,
      ],
    }).onDelete("restrict"),
    check(
      "catalogue_product_modifier_groups_min_selections_check",
      sql`${table.minSelections} IS NULL OR ${table.minSelections} >= 0`,
    ),
    check(
      "catalogue_product_modifier_groups_max_selections_check",
      sql`${table.maxSelections} IS NULL OR ${table.maxSelections} >= 0`,
    ),
    check(
      "catalogue_product_modifier_groups_bounds_check",
      sql`${table.minSelections} IS NULL OR ${table.maxSelections} IS NULL OR ${table.minSelections} <= ${table.maxSelections}`,
    ),
    check(
      "catalogue_product_modifier_groups_selection_count_mode_check",
      sql`${table.selectionCountMode} IS NULL OR ${table.selectionCountMode} IN ('distinct_options', 'total_quantity')`,
    ),
    check(
      "catalogue_product_modifier_groups_version_check",
      sql`${table.version} >= 1`,
    ),
    unique("catalogue_product_modifier_groups_unique").on(
      table.tenantId,
      table.productId,
      table.modifierGroupId,
    ),
    index("catalogue_product_modifier_groups_tenant_id_idx").on(table.tenantId),
  ],
);

export const catalogueCategories = qos.table(
  "catalogue_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    publicId: text("public_id").notNull(),
    internalName: text("internal_name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    version: integer("version").notNull().default(1),
    status: productStatusEnum("status").notNull().default("active"),
    provenance: dataProvenanceEnum("provenance").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("catalogue_categories_tenant_public_id_unique").on(
      table.tenantId,
      table.publicId,
    ),
    unique("catalogue_categories_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    index("catalogue_categories_tenant_id_idx").on(table.tenantId),
  ],
);

export const catalogueCategoryTranslations = qos.table(
  "catalogue_category_translations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    locale: text("locale").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.categoryId],
      foreignColumns: [catalogueCategories.tenantId, catalogueCategories.id],
    }).onDelete("restrict"),
    unique("catalogue_category_translations_unique").on(
      table.tenantId,
      table.categoryId,
      table.locale,
    ),
    index("catalogue_category_translations_tenant_id_idx").on(table.tenantId),
  ],
);

export const catalogueProductCategories = qos.table(
  "catalogue_product_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    productId: uuid("product_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [catalogueProducts.tenantId, catalogueProducts.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.categoryId],
      foreignColumns: [catalogueCategories.tenantId, catalogueCategories.id],
    }).onDelete("restrict"),
    unique("catalogue_product_categories_unique").on(
      table.tenantId,
      table.productId,
      table.categoryId,
    ),
    index("catalogue_product_categories_tenant_id_idx").on(table.tenantId),
  ],
);

export const catalogueMenus = qos.table(
  "catalogue_menus",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    brandId: uuid("brand_id").notNull(),
    publicId: text("public_id").notNull(),
    internalName: text("internal_name").notNull(),
    status: productStatusEnum("status").notNull().default("draft"),
    version: integer("version").notNull().default(1),
    publishedVersion: integer("published_version"),
    provenance: dataProvenanceEnum("provenance").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.brandId],
      foreignColumns: [brands.tenantId, brands.id],
    }).onDelete("restrict"),
    unique("catalogue_menus_tenant_public_id_unique").on(
      table.tenantId,
      table.publicId,
    ),
    unique("catalogue_menus_tenant_id_id_unique").on(table.tenantId, table.id),
    index("catalogue_menus_tenant_id_idx").on(table.tenantId),
  ],
);

export const catalogueMenuTranslations = qos.table(
  "catalogue_menu_translations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    menuId: uuid("menu_id").notNull(),
    locale: text("locale").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    translationVersion: integer("translation_version").notNull().default(1),
    approvalStatus: translationApprovalStatusEnum("approval_status")
      .notNull()
      .default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.menuId],
      foreignColumns: [catalogueMenus.tenantId, catalogueMenus.id],
    }).onDelete("restrict"),
    unique("catalogue_menu_translations_unique").on(
      table.tenantId,
      table.menuId,
      table.locale,
    ),
    index("catalogue_menu_translations_tenant_id_idx").on(table.tenantId),
  ],
);

export const catalogueMenuLocations = qos.table(
  "catalogue_menu_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    menuId: uuid("menu_id").notNull(),
    locationId: uuid("location_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.menuId],
      foreignColumns: [catalogueMenus.tenantId, catalogueMenus.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [locations.tenantId, locations.id],
    }).onDelete("restrict"),
    unique("catalogue_menu_locations_unique").on(
      table.tenantId,
      table.menuId,
      table.locationId,
    ),
    index("catalogue_menu_locations_tenant_id_idx").on(table.tenantId),
  ],
);

export const catalogueMenuSections = qos.table(
  "catalogue_menu_sections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    menuId: uuid("menu_id").notNull(),
    publicId: text("public_id").notNull(),
    internalName: text("internal_name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.menuId],
      foreignColumns: [catalogueMenus.tenantId, catalogueMenus.id],
    }).onDelete("restrict"),
    unique("catalogue_menu_sections_tenant_public_id_unique").on(
      table.tenantId,
      table.publicId,
    ),
    unique("catalogue_menu_sections_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    index("catalogue_menu_sections_tenant_id_idx").on(table.tenantId),
  ],
);

export const catalogueMenuSectionTranslations = qos.table(
  "catalogue_menu_section_translations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    sectionId: uuid("section_id").notNull(),
    locale: text("locale").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    translationVersion: integer("translation_version").notNull().default(1),
    approvalStatus: translationApprovalStatusEnum("approval_status")
      .notNull()
      .default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.sectionId],
      foreignColumns: [catalogueMenuSections.tenantId, catalogueMenuSections.id],
    }).onDelete("restrict"),
    unique("catalogue_menu_section_translations_unique").on(
      table.tenantId,
      table.sectionId,
      table.locale,
    ),
    index("catalogue_menu_section_translations_tenant_id_idx").on(
      table.tenantId,
    ),
  ],
);

export const catalogueMenuSectionProducts = qos.table(
  "catalogue_menu_section_products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    sectionId: uuid("section_id").notNull(),
    productId: uuid("product_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.sectionId],
      foreignColumns: [catalogueMenuSections.tenantId, catalogueMenuSections.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [catalogueProducts.tenantId, catalogueProducts.id],
    }).onDelete("restrict"),
    unique("catalogue_menu_section_products_unique").on(
      table.tenantId,
      table.sectionId,
      table.productId,
    ),
    index("catalogue_menu_section_products_tenant_id_idx").on(table.tenantId),
  ],
);

export type PublicMenuProductSnapshot = {
  productPublicId: string;
  sortOrder: number;
  translations: Record<
    string,
    { displayName: string; description: string | null }
  >;
  price: {
    amountMinor: number;
    currency: string;
    inheritanceMode: "inherited" | "override";
  };
  mediaAssetId: string | null;
};

export type MenuLiveSnapshotPayload = {
  menuPublicId: string;
  locationPublicId: string;
  version: number;
  translations: Record<
    string,
    { displayName: string; description: string | null }
  >;
  sections: Array<{
    publicId: string;
    sortOrder: number;
    translations: Record<
      string,
      { displayName: string; description: string | null }
    >;
    products: PublicMenuProductSnapshot[];
  }>;
};

export const menuPublishOperationStatusEnum = qos.enum(
  "menu_publish_operation_status",
  ["completed", "partial", "failed"],
);

export const menuPublicLinkStatusEnum = qos.enum("menu_public_link_status", [
  "active",
  "paused",
]);

export const storefrontStatusEnum = qos.enum("storefront_status", [
  "draft",
  "active",
  "archived",
]);

export const storefrontDomainTypeEnum = qos.enum("storefront_domain_type", [
  "platform_subdomain",
  "custom_domain",
]);

export const storefrontDomainVerificationStatusEnum = qos.enum(
  "storefront_domain_verification_status",
  ["pending", "verified", "failed"],
);

export const storefrontDomainLifecycleStatusEnum = qos.enum(
  "storefront_domain_lifecycle_status",
  ["provisioning", "active", "inactive"],
);

export const storefrontDeploymentLifecycleStatusEnum = qos.enum(
  "storefront_deployment_lifecycle_status",
  ["provisioning", "active", "inactive"],
);

export type StorefrontDraftConfig = {
  theme?: Record<string, unknown>;
  navigation?: Array<{ id: string; labelKey: string; href: string }>;
  contentBlocks?: Array<{
    id: string;
    type: string;
    schemaVersion?: number;
    visible?: boolean;
    props: Record<string, unknown>;
  }>;
  featureFlags?: Record<string, boolean>;
};

export type StorefrontReleasePayload = {
  storefrontPublicId: string;
  releaseVersion: number;
  defaultLocale: string;
  supportedLocales: string[];
  theme: Record<string, unknown>;
  navigation: StorefrontDraftConfig["navigation"];
  contentBlocks: StorefrontDraftConfig["contentBlocks"];
  locations: Array<{ locationPublicId: string }>;
  publishedCollections: Array<{
    locationPublicId: string;
    menuPublicId: string;
    publicMenuKey?: string;
  }>;
  featureFlags?: Record<string, boolean>;
};

export const catalogueMenuLiveRevisions = qos.table(
  "catalogue_menu_live_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    menuId: uuid("menu_id").notNull(),
    locationId: uuid("location_id").notNull(),
    sourceVersion: integer("source_version").notNull(),
    payload: jsonb("payload").$type<MenuLiveSnapshotPayload>().notNull(),
    publishedBySubject: text("published_by_subject").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.menuId],
      foreignColumns: [catalogueMenus.tenantId, catalogueMenus.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [locations.tenantId, locations.id],
    }).onDelete("restrict"),
    unique("catalogue_menu_live_revisions_menu_location_unique").on(
      table.tenantId,
      table.menuId,
      table.locationId,
    ),
    index("catalogue_menu_live_revisions_tenant_id_idx").on(table.tenantId),
  ],
);

export const catalogueMenuPublishOperations = qos.table(
  "catalogue_menu_publish_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    menuId: uuid("menu_id").notNull(),
    operationPublicId: text("operation_public_id").notNull(),
    publisherSubject: text("publisher_subject").notNull(),
    sourceVersion: integer("source_version").notNull(),
    targetLocationIds: jsonb("target_location_ids").$type<string[]>().notNull(),
    status: menuPublishOperationStatusEnum("status").notNull(),
    locationResults: jsonb("location_results")
      .$type<
        Array<{
          locationId: string;
          locationPublicId: string;
          success: boolean;
          error?: string;
          field?: string;
        }>
      >()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.menuId],
      foreignColumns: [catalogueMenus.tenantId, catalogueMenus.id],
    }).onDelete("restrict"),
    unique("catalogue_menu_publish_operations_unique").on(
      table.tenantId,
      table.operationPublicId,
    ),
    index("catalogue_menu_publish_operations_tenant_id_idx").on(table.tenantId),
  ],
);

export const catalogueMenuPublicLinks = qos.table(
  "catalogue_menu_public_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    menuId: uuid("menu_id").notNull(),
    locationId: uuid("location_id").notNull(),
    publicKey: text("public_key").notNull(),
    status: menuPublicLinkStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.menuId],
      foreignColumns: [catalogueMenus.tenantId, catalogueMenus.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [locations.tenantId, locations.id],
    }).onDelete("restrict"),
    unique("catalogue_menu_public_links_menu_location_unique").on(
      table.tenantId,
      table.menuId,
      table.locationId,
    ),
    unique("catalogue_menu_public_links_public_key_unique").on(table.publicKey),
    index("catalogue_menu_public_links_tenant_id_idx").on(table.tenantId),
  ],
);

export const storefronts = qos.table(
  "storefronts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    brandId: uuid("brand_id").notNull(),
    publicId: text("public_id").notNull(),
    internalName: text("internal_name").notNull(),
    slug: text("slug").notNull(),
    status: storefrontStatusEnum("status").notNull().default("draft"),
    defaultLocale: text("default_locale").notNull(),
    supportedLocales: text("supported_locales").array().notNull(),
    draftConfig: jsonb("draft_config")
      .$type<StorefrontDraftConfig>()
      .notNull()
      .default({}),
    version: integer("version").notNull().default(1),
    activeReleaseId: uuid("active_release_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.brandId],
      foreignColumns: [brands.tenantId, brands.id],
    }).onDelete("restrict"),
    unique("storefronts_tenant_public_id_unique").on(
      table.tenantId,
      table.publicId,
    ),
    unique("storefronts_tenant_slug_unique").on(table.tenantId, table.slug),
    unique("storefronts_tenant_id_id_unique").on(table.tenantId, table.id),
    index("storefronts_tenant_id_idx").on(table.tenantId),
  ],
);

export const storefrontReleases = qos.table(
  "storefront_releases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    storefrontId: uuid("storefront_id").notNull(),
    publicId: text("public_id").notNull(),
    releaseVersion: integer("release_version").notNull(),
    payload: jsonb("payload").$type<StorefrontReleasePayload>().notNull(),
    publishedBySubject: text("published_by_subject").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.storefrontId],
      foreignColumns: [storefronts.tenantId, storefronts.id],
    }).onDelete("restrict"),
    unique("storefront_releases_tenant_public_id_unique").on(
      table.tenantId,
      table.publicId,
    ),
    unique("storefront_releases_storefront_version_unique").on(
      table.tenantId,
      table.storefrontId,
      table.releaseVersion,
    ),
    unique("storefront_releases_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    index("storefront_releases_tenant_id_idx").on(table.tenantId),
  ],
);

export const storefrontDomains = qos.table(
  "storefront_domains",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    storefrontId: uuid("storefront_id").notNull(),
    hostname: text("hostname").notNull(),
    domainType: storefrontDomainTypeEnum("domain_type").notNull(),
    verificationStatus: storefrontDomainVerificationStatusEnum(
      "verification_status",
    )
      .notNull()
      .default("pending"),
    lifecycleStatus: storefrontDomainLifecycleStatusEnum("lifecycle_status")
      .notNull()
      .default("provisioning"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.storefrontId],
      foreignColumns: [storefronts.tenantId, storefronts.id],
    }).onDelete("restrict"),
    unique("storefront_domains_hostname_unique").on(table.hostname),
    unique("storefront_domains_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    index("storefront_domains_tenant_id_idx").on(table.tenantId),
  ],
);

export const storefrontDeployments = qos.table(
  "storefront_deployments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    storefrontId: uuid("storefront_id").notNull(),
    publicId: text("public_id").notNull(),
    environment: text("environment").notNull(),
    region: text("region").notNull(),
    containerAppName: text("container_app_name").notNull(),
    lifecycleStatus: storefrontDeploymentLifecycleStatusEnum("lifecycle_status")
      .notNull()
      .default("provisioning"),
    applicationVersion: text("application_version").notNull(),
    imageRepository: text("image_repository").notNull().default("qos-storefront"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.storefrontId],
      foreignColumns: [storefronts.tenantId, storefronts.id],
    }).onDelete("restrict"),
    unique("storefront_deployments_tenant_public_id_unique").on(
      table.tenantId,
      table.publicId,
    ),
    unique("storefront_deployments_container_app_name_unique").on(
      table.containerAppName,
    ),
    unique("storefront_deployments_storefront_environment_unique").on(
      table.tenantId,
      table.storefrontId,
      table.environment,
    ),
    unique("storefront_deployments_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    index("storefront_deployments_tenant_id_idx").on(table.tenantId),
    index("storefront_deployments_storefront_id_idx").on(
      table.tenantId,
      table.storefrontId,
    ),
  ],
);

export const storefrontLocations = qos.table(
  "storefront_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    storefrontId: uuid("storefront_id").notNull(),
    locationId: uuid("location_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.storefrontId],
      foreignColumns: [storefronts.tenantId, storefronts.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [locations.tenantId, locations.id],
    }).onDelete("restrict"),
    unique("storefront_locations_unique").on(
      table.tenantId,
      table.storefrontId,
      table.locationId,
    ),
    index("storefront_locations_tenant_id_idx").on(table.tenantId),
  ],
);

export const storefrontPublishedCollections = qos.table(
  "storefront_published_collections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    storefrontId: uuid("storefront_id").notNull(),
    locationId: uuid("location_id").notNull(),
    menuId: uuid("menu_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.storefrontId],
      foreignColumns: [storefronts.tenantId, storefronts.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [locations.tenantId, locations.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.menuId],
      foreignColumns: [catalogueMenus.tenantId, catalogueMenus.id],
    }).onDelete("restrict"),
    unique("storefront_published_collections_location_unique").on(
      table.tenantId,
      table.storefrontId,
      table.locationId,
    ),
    index("storefront_published_collections_tenant_id_idx").on(table.tenantId),
  ],
);

export const customerAssociationStatusEnum = qos.enum("customer_association_status", [
  "active",
  "suspended",
]);

export const customerAuthUsers = qos.table(
  "customer_auth_users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique("customer_auth_users_email_unique").on(table.email)],
);

export const customerAuthSessions = qos.table(
  "customer_auth_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => customerAuthUsers.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique("customer_auth_sessions_token_unique").on(table.token)],
);

export const customerAuthAccounts = qos.table("customer_auth_accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => customerAuthUsers.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const customerAuthVerifications = qos.table("customer_auth_verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const staffAuthUsers = qos.table(
  "staff_auth_users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique("staff_auth_users_email_unique").on(table.email)],
);

export const staffAuthSessions = qos.table(
  "staff_auth_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => staffAuthUsers.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique("staff_auth_sessions_token_unique").on(table.token)],
);

export const staffAuthAccounts = qos.table("staff_auth_accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => staffAuthUsers.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const staffAuthVerifications = qos.table("staff_auth_verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const storefrontCustomerAssociations = qos.table(
  "storefront_customer_associations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    storefrontId: uuid("storefront_id").notNull(),
    customerUserId: text("customer_user_id")
      .notNull()
      .references(() => customerAuthUsers.id, { onDelete: "restrict" }),
    phone: text("phone"),
    status: customerAssociationStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.storefrontId],
      foreignColumns: [storefronts.tenantId, storefronts.id],
    }).onDelete("restrict"),
    unique("storefront_customer_associations_tenant_user_unique").on(
      table.tenantId,
      table.customerUserId,
    ),
    unique("storefront_customer_associations_storefront_user_unique").on(
      table.tenantId,
      table.storefrontId,
      table.customerUserId,
    ),
    index("storefront_customer_associations_tenant_id_idx").on(table.tenantId),
  ],
);

export const anonymousSessionStatusEnum = qos.enum("anonymous_session_status", [
  "active",
  "expired",
]);

export const anonymousBasketStatusEnum = qos.enum("anonymous_basket_status", [
  "active",
  "expired",
]);

export const storefrontAnonymousSessions = qos.table(
  "storefront_anonymous_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    storefrontId: uuid("storefront_id").notNull(),
    locationId: uuid("location_id").notNull(),
    menuId: uuid("menu_id").notNull(),
    sessionTokenHash: text("session_token_hash").notNull(),
    csrfToken: text("csrf_token").notNull(),
    locale: text("locale").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    status: anonymousSessionStatusEnum("status").notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.storefrontId],
      foreignColumns: [storefronts.tenantId, storefronts.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [locations.tenantId, locations.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.menuId],
      foreignColumns: [catalogueMenus.tenantId, catalogueMenus.id],
    }).onDelete("restrict"),
    unique("storefront_anonymous_sessions_token_hash_unique").on(
      table.sessionTokenHash,
    ),
    unique("storefront_anonymous_sessions_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    index("storefront_anonymous_sessions_tenant_id_idx").on(table.tenantId),
  ],
);

export const storefrontAnonymousBaskets = qos.table(
  "storefront_anonymous_baskets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    publicId: text("public_id").notNull(),
    version: integer("version").notNull().default(1),
    status: anonymousBasketStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.sessionId],
      foreignColumns: [
        storefrontAnonymousSessions.tenantId,
        storefrontAnonymousSessions.id,
      ],
    }).onDelete("restrict"),
    unique("storefront_anonymous_baskets_tenant_public_id_unique").on(
      table.tenantId,
      table.publicId,
    ),
    unique("storefront_anonymous_baskets_session_unique").on(
      table.tenantId,
      table.sessionId,
    ),
    unique("storefront_anonymous_baskets_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    index("storefront_anonymous_baskets_tenant_id_idx").on(table.tenantId),
  ],
);

export const storefrontAnonymousBasketLines = qos.table(
  "storefront_anonymous_basket_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    basketId: uuid("basket_id").notNull(),
    publicId: text("public_id").notNull(),
    productPublicId: text("product_public_id").notNull(),
    quantity: integer("quantity").notNull(),
    unitAmountMinor: integer("unit_amount_minor").notNull(),
    unitCurrency: char("unit_currency", { length: 3 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.basketId],
      foreignColumns: [
        storefrontAnonymousBaskets.tenantId,
        storefrontAnonymousBaskets.id,
      ],
    }).onDelete("restrict"),
    unique("storefront_anonymous_basket_lines_tenant_public_id_unique").on(
      table.tenantId,
      table.publicId,
    ),
    unique("storefront_anonymous_basket_lines_product_unique").on(
      table.tenantId,
      table.basketId,
      table.productPublicId,
    ),
    index("storefront_anonymous_basket_lines_tenant_id_idx").on(table.tenantId),
  ],
);

export const storefrontAnonymousBasketMutations = qos.table(
  "storefront_anonymous_basket_mutations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    basketId: uuid("basket_id").notNull(),
    mutationId: text("mutation_id").notNull(),
    responseSnapshot: jsonb("response_snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.basketId],
      foreignColumns: [
        storefrontAnonymousBaskets.tenantId,
        storefrontAnonymousBaskets.id,
      ],
    }).onDelete("restrict"),
    unique("storefront_anonymous_basket_mutations_unique").on(
      table.tenantId,
      table.basketId,
      table.mutationId,
    ),
    index("storefront_anonymous_basket_mutations_tenant_id_idx").on(
      table.tenantId,
    ),
  ],
);

export const storefrontCustomerBaskets = qos.table(
  "storefront_customer_baskets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    storefrontId: uuid("storefront_id").notNull(),
    locationId: uuid("location_id").notNull(),
    menuId: uuid("menu_id").notNull(),
    customerUserId: text("customer_user_id")
      .notNull()
      .references(() => customerAuthUsers.id, { onDelete: "restrict" }),
    publicId: text("public_id").notNull(),
    version: integer("version").notNull().default(1),
    status: anonymousBasketStatusEnum("status").notNull().default("active"),
    locale: text("locale").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.storefrontId],
      foreignColumns: [storefronts.tenantId, storefronts.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [locations.tenantId, locations.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.menuId],
      foreignColumns: [catalogueMenus.tenantId, catalogueMenus.id],
    }).onDelete("restrict"),
    unique("storefront_customer_baskets_tenant_public_id_unique").on(
      table.tenantId,
      table.publicId,
    ),
    unique("storefront_customer_baskets_context_unique").on(
      table.tenantId,
      table.customerUserId,
      table.storefrontId,
      table.locationId,
    ),
    unique("storefront_customer_baskets_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    index("storefront_customer_baskets_tenant_id_idx").on(table.tenantId),
  ],
);

export const storefrontCustomerBasketLines = qos.table(
  "storefront_customer_basket_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    basketId: uuid("basket_id").notNull(),
    publicId: text("public_id").notNull(),
    productPublicId: text("product_public_id").notNull(),
    quantity: integer("quantity").notNull(),
    unitAmountMinor: integer("unit_amount_minor").notNull(),
    unitCurrency: char("unit_currency", { length: 3 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.basketId],
      foreignColumns: [storefrontCustomerBaskets.tenantId, storefrontCustomerBaskets.id],
    }).onDelete("restrict"),
    unique("storefront_customer_basket_lines_tenant_public_id_unique").on(
      table.tenantId,
      table.publicId,
    ),
    unique("storefront_customer_basket_lines_product_unique").on(
      table.tenantId,
      table.basketId,
      table.productPublicId,
    ),
    index("storefront_customer_basket_lines_tenant_id_idx").on(table.tenantId),
  ],
);

export const storefrontCustomerBasketMutations = qos.table(
  "storefront_customer_basket_mutations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    basketId: uuid("basket_id").notNull(),
    mutationId: text("mutation_id").notNull(),
    responseSnapshot: jsonb("response_snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.basketId],
      foreignColumns: [storefrontCustomerBaskets.tenantId, storefrontCustomerBaskets.id],
    }).onDelete("restrict"),
    unique("storefront_customer_basket_mutations_unique").on(
      table.tenantId,
      table.basketId,
      table.mutationId,
    ),
    index("storefront_customer_basket_mutations_tenant_id_idx").on(
      table.tenantId,
    ),
  ],
);

export const storefrontBasketMergeOperations = qos.table(
  "storefront_basket_merge_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    customerUserId: text("customer_user_id")
      .notNull()
      .references(() => customerAuthUsers.id, { onDelete: "restrict" }),
    anonymousBasketId: uuid("anonymous_basket_id").notNull(),
    accountBasketId: uuid("account_basket_id").notNull(),
    operationId: text("operation_id").notNull(),
    decision: text("decision").notNull(),
    payloadHash: text("payload_hash").notNull(),
    anonymousExpectedVersion: integer("anonymous_expected_version").notNull(),
    accountExpectedVersion: integer("account_expected_version").notNull(),
    responseSnapshot: jsonb("response_snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("storefront_basket_merge_operations_unique").on(
      table.tenantId,
      table.customerUserId,
      table.operationId,
    ),
    index("storefront_basket_merge_operations_tenant_id_idx").on(table.tenantId),
  ],
);

export const storefrontCheckoutQuotes = qos.table(
  "storefront_checkout_quotes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    customerUserId: text("customer_user_id")
      .notNull()
      .references(() => customerAuthUsers.id, { onDelete: "restrict" }),
    basketId: uuid("basket_id").notNull(),
    publicId: text("public_id").notNull(),
    version: integer("version").notNull().default(1),
    basketVersion: integer("basket_version").notNull(),
    basketPublicId: text("basket_public_id").notNull(),
    pricingPolicyVersion: integer("pricing_policy_version").notNull(),
    couponCode: text("coupon_code"),
    locale: text("locale").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    isTest: boolean("is_test").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    snapshot: jsonb("snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.basketId],
      foreignColumns: [storefrontCustomerBaskets.tenantId, storefrontCustomerBaskets.id],
    }).onDelete("restrict"),
    unique("storefront_checkout_quotes_tenant_public_id_unique").on(
      table.tenantId,
      table.publicId,
    ),
    unique("storefront_checkout_quotes_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    index("storefront_checkout_quotes_tenant_id_idx").on(table.tenantId),
  ],
);

export const storefrontCheckoutQuoteOperations = qos.table(
  "storefront_checkout_quote_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    customerUserId: text("customer_user_id")
      .notNull()
      .references(() => customerAuthUsers.id, { onDelete: "restrict" }),
    basketId: uuid("basket_id").notNull(),
    operationId: text("operation_id").notNull(),
    requestHash: text("request_hash").notNull(),
    quoteId: uuid("quote_id").notNull(),
    responseSnapshot: jsonb("response_snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.quoteId],
      foreignColumns: [storefrontCheckoutQuotes.tenantId, storefrontCheckoutQuotes.id],
    }).onDelete("restrict"),
    unique("storefront_checkout_quote_operations_unique").on(
      table.tenantId,
      table.customerUserId,
      table.operationId,
    ),
    index("storefront_checkout_quote_operations_tenant_id_idx").on(table.tenantId),
  ],
);

export const checkoutPaymentAttemptStatusEnum = qos.enum(
  "checkout_payment_attempt_status",
  [
    "pending",
    "provider_handoff",
    "unknown",
    "succeeded",
    "failed",
    "cancelled",
    "expired",
  ],
);

export const checkoutProviderEventProcessingStatusEnum = qos.enum(
  "checkout_provider_event_processing_status",
  ["received", "processed", "rejected", "ignored"],
);

export const checkoutPaymentProviderModeEnum = qos.enum(
  "checkout_payment_provider_mode",
  ["sandbox", "fixture"],
);

export const storefrontCheckoutPaymentAttempts = qos.table(
  "storefront_checkout_payment_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    customerUserId: text("customer_user_id")
      .notNull()
      .references(() => customerAuthUsers.id, { onDelete: "restrict" }),
    quoteId: uuid("quote_id").notNull(),
    basketId: uuid("basket_id").notNull(),
    publicId: text("public_id").notNull(),
    status: checkoutPaymentAttemptStatusEnum("status").notNull().default("pending"),
    provider: text("provider").notNull().default("stripe"),
    providerMode: checkoutPaymentProviderModeEnum("provider_mode").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    quoteSnapshot: jsonb("quote_snapshot").notNull(),
    providerReference: text("provider_reference"),
    providerIdempotencyKey: text("provider_idempotency_key").notNull(),
    returnUrl: text("return_url").notNull(),
    cancelUrl: text("cancel_url").notNull(),
    handoffSnapshot: jsonb("handoff_snapshot"),
    outcomeSnapshot: jsonb("outcome_snapshot"),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    lastProviderEventId: text("last_provider_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.quoteId],
      foreignColumns: [storefrontCheckoutQuotes.tenantId, storefrontCheckoutQuotes.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.basketId],
      foreignColumns: [storefrontCustomerBaskets.tenantId, storefrontCustomerBaskets.id],
    }).onDelete("restrict"),
    unique("storefront_checkout_payment_attempts_tenant_public_id_unique").on(
      table.tenantId,
      table.publicId,
    ),
    index("storefront_checkout_payment_attempts_customer_public_id_idx").on(
      table.tenantId,
      table.customerUserId,
      table.publicId,
    ),
    unique("storefront_checkout_payment_attempts_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    index("storefront_checkout_payment_attempts_tenant_id_idx").on(table.tenantId),
    index("storefront_checkout_payment_attempts_quote_id_idx").on(
      table.tenantId,
      table.quoteId,
    ),
  ],
);

export const storefrontCheckoutProviderEvents = qos.table(
  "storefront_checkout_provider_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    provider: text("provider").notNull().default("stripe"),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    livemode: boolean("livemode").notNull().default(false),
    paymentAttemptId: uuid("payment_attempt_id"),
    payloadSummary: jsonb("payload_summary").notNull(),
    processingStatus: checkoutProviderEventProcessingStatusEnum("processing_status")
      .notNull()
      .default("received"),
    rejectionReason: text("rejection_reason"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.paymentAttemptId],
      foreignColumns: [
        storefrontCheckoutPaymentAttempts.tenantId,
        storefrontCheckoutPaymentAttempts.id,
      ],
    }).onDelete("restrict"),
    unique("storefront_checkout_provider_events_provider_event_unique").on(
      table.provider,
      table.providerEventId,
    ),
    index("storefront_checkout_provider_events_tenant_id_idx").on(table.tenantId),
    index("storefront_checkout_provider_events_payment_attempt_idx").on(
      table.tenantId,
      table.paymentAttemptId,
    ),
  ],
);

export const storefrontCheckoutPaymentOperations = qos.table(
  "storefront_checkout_payment_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    customerUserId: text("customer_user_id")
      .notNull()
      .references(() => customerAuthUsers.id, { onDelete: "restrict" }),
    operationId: text("operation_id").notNull(),
    requestHash: text("request_hash").notNull(),
    paymentAttemptId: uuid("payment_attempt_id").notNull(),
    responseSnapshot: jsonb("response_snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.paymentAttemptId],
      foreignColumns: [
        storefrontCheckoutPaymentAttempts.tenantId,
        storefrontCheckoutPaymentAttempts.id,
      ],
    }).onDelete("restrict"),
    unique("storefront_checkout_payment_operations_unique").on(
      table.tenantId,
      table.customerUserId,
      table.operationId,
    ),
    index("storefront_checkout_payment_operations_tenant_id_idx").on(table.tenantId),
  ],
);

export const mediaAssetStatusEnum = qos.enum("media_asset_status", [
  "pending_upload",
  "uploaded",
  "processing",
  "approved",
  "rejected",
  "failed",
]);

export const mediaUploadGrantStatusEnum = qos.enum("media_upload_grant_status", [
  "pending",
  "used",
  "expired",
]);

export const mediaDerivativeKindEnum = qos.enum("media_derivative_kind", [
  "thumbnail",
  "display",
  "video_playback",
  "video_poster",
]);

export const videoProcessingJobStatusEnum = qos.enum("video_processing_job_status", [
  "queued",
  "processing",
  "ready",
  "failed",
  "rejected",
  "quarantined",
]);

export const catalogueMediaAssets = qos.table(
  "catalogue_media_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    productId: uuid("product_id").notNull(),
    publicId: text("public_id").notNull(),
    status: mediaAssetStatusEnum("status").notNull().default("pending_upload"),
    contentType: text("content_type"),
    altTextEn: text("alt_text_en"),
    altTextAr: text("alt_text_ar"),
    sourceProvenance: dataProvenanceEnum("source_provenance")
      .notNull()
      .default("operator_entered"),
    /** Private AI generation/review record; only set when provenance is ai_generated. */
    generationMetadata: jsonb("generation_metadata").$type<Record<string, unknown>>(),
    failureReason: text("failure_reason"),
    approvedBySubject: text("approved_by_subject"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [catalogueProducts.tenantId, catalogueProducts.id],
    }).onDelete("restrict"),
    unique("catalogue_media_assets_tenant_public_id_unique").on(
      table.tenantId,
      table.publicId,
    ),
    unique("catalogue_media_assets_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    index("catalogue_media_assets_tenant_id_idx").on(table.tenantId),
    index("catalogue_media_assets_tenant_provenance_created_idx").on(
      table.tenantId,
      table.sourceProvenance,
      table.createdAt,
    ),
  ],
);

export const catalogueMediaUploadGrants = qos.table(
  "catalogue_media_upload_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    assetId: uuid("asset_id").notNull(),
    grantToken: text("grant_token").notNull(),
    privateStoragePath: text("private_storage_path").notNull(),
    expectedByteSize: integer("expected_byte_size").notNull(),
    expectedContentType: text("expected_content_type").notNull(),
    status: mediaUploadGrantStatusEnum("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.assetId],
      foreignColumns: [catalogueMediaAssets.tenantId, catalogueMediaAssets.id],
    }).onDelete("restrict"),
    unique("catalogue_media_upload_grants_token_unique").on(table.grantToken),
    index("catalogue_media_upload_grants_tenant_id_idx").on(table.tenantId),
  ],
);

export const catalogueMediaDerivatives = qos.table(
  "catalogue_media_derivatives",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    assetId: uuid("asset_id").notNull(),
    derivativeKind: mediaDerivativeKindEnum("derivative_kind").notNull(),
    publicDerivativeId: text("public_derivative_id").notNull(),
    storagePath: text("storage_path").notNull(),
    contentType: text("content_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    byteSize: integer("byte_size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.assetId],
      foreignColumns: [catalogueMediaAssets.tenantId, catalogueMediaAssets.id],
    }).onDelete("restrict"),
    unique("catalogue_media_derivatives_public_id_unique").on(
      table.publicDerivativeId,
    ),
    unique("catalogue_media_derivatives_asset_kind_unique").on(
      table.tenantId,
      table.assetId,
      table.derivativeKind,
    ),
    index("catalogue_media_derivatives_tenant_id_idx").on(table.tenantId),
  ],
);

export const videoProcessingJobs = qos.table(
  "video_processing_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    assetId: uuid("asset_id").notNull(),
    productId: uuid("product_id").notNull(),
    correlationId: text("correlation_id").notNull(),
    sourceStoragePath: text("source_storage_path").notNull(),
    status: videoProcessingJobStatusEnum("status").notNull().default("queued"),
    retryCount: integer("retry_count").notNull().default(0),
    lastErrorMessage: text("last_error_message"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    claimedBy: text("claimed_by"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.assetId],
      foreignColumns: [catalogueMediaAssets.tenantId, catalogueMediaAssets.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [catalogueProducts.tenantId, catalogueProducts.id],
    }).onDelete("restrict"),
    unique("video_processing_jobs_correlation_id_unique").on(
      table.correlationId,
    ),
    index("video_processing_jobs_tenant_id_idx").on(table.tenantId),
    index("video_processing_jobs_status_idx").on(table.status),
    index("video_processing_jobs_asset_id_idx").on(table.assetId),
    index("video_processing_jobs_status_next_attempt_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
    index("video_processing_jobs_tenant_started_idx").on(
      table.tenantId,
      table.startedAt,
    ),
  ],
);

export const staffAccessRequests = qos.table(
  "staff_access_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    requesterSubject: text("requester_subject").notNull(),
    requesterEmail: text("requester_email").notNull(),
    status: accessRequestStatusEnum("status").notNull().default("pending"),
    version: integer("version").notNull().default(1),
    decidedBySubject: text("decided_by_subject"),
    decidedRole: staffRoleEnum("decided_role"),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => [
    unique("staff_access_requests_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    index("staff_access_requests_tenant_id_idx").on(table.tenantId),
    index("staff_access_requests_requester_subject_idx").on(
      table.requesterSubject,
    ),
  ],
);

export const staffAccessRequestLocations = qos.table(
  "staff_access_request_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    accessRequestId: uuid("access_request_id").notNull(),
    locationId: uuid("location_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.accessRequestId],
      foreignColumns: [staffAccessRequests.tenantId, staffAccessRequests.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [locations.tenantId, locations.id],
    }).onDelete("restrict"),
    unique("staff_access_request_locations_unique").on(
      table.accessRequestId,
      table.locationId,
    ),
  ],
);

export const tenantAuditEvents = qos.table(
  "tenant_audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    locationId: uuid("location_id"),
    actorSubject: text("actor_subject").notNull(),
    actorClass: auditActorClassEnum("actor_class").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityPublicId: text("entity_public_id").notNull(),
    entityVersion: integer("entity_version"),
    correlationId: uuid("correlation_id").notNull(),
    changeSummary: jsonb("change_summary").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [locations.tenantId, locations.id],
    }).onDelete("restrict"),
    index("tenant_audit_events_tenant_id_idx").on(table.tenantId),
    index("tenant_audit_events_tenant_occurred_at_idx").on(
      table.tenantId,
      table.occurredAt,
    ),
    index("tenant_audit_events_tenant_entity_idx").on(
      table.tenantId,
      table.entityType,
      table.entityPublicId,
    ),
    index("tenant_audit_events_tenant_action_idx").on(
      table.tenantId,
      table.action,
    ),
  ],
);

export const catalogueImportOperationStatusEnum = qos.enum(
  "catalogue_import_operation_status",
  ["preview_ready", "applied", "failed"],
);

export type CatalogueImportColumnMapping = {
  sourceId: string;
  internalName: string;
  displayNameEn: string;
  displayNameAr: string;
  descriptionEn?: string;
  descriptionAr?: string;
  variantLabelEn?: string;
  variantLabelAr?: string;
  amountMinor: string;
  currency: string;
  sku?: string;
  barcode?: string;
  imageUrl?: string;
};

export type CatalogueImportPreviewRow = {
  sourceRow: number;
  sourceId: string;
  status: "create" | "update" | "unchanged" | "duplicate" | "error";
  reason: string | null;
  productPublicId: string | null;
  expectedProductVersion: number | null;
  internalName: string | null;
  displayNameEn: string | null;
  displayNameAr: string | null;
  amountMinor: number | null;
  currency: string | null;
  imageUrl: string | null;
  ingestImage: boolean;
};

export type CatalogueImportPreviewPayload = {
  connectionKey: string;
  fileName: string;
  rowCount: number;
  rows: CatalogueImportPreviewRow[];
  errorCount: number;
  createCount: number;
  updateCount: number;
  unchangedCount: number;
  duplicateCount: number;
};

export type CatalogueImportApplyReport = {
  appliedAt: string;
  createCount: number;
  updateCount: number;
  unchangedCount: number;
  skippedCount: number;
  conflictCount: number;
  errorCount: number;
  media?: {
    uploaded: number;
    alreadyPresent: number;
    repaired: number;
  };
  errorCategories?: {
    "finedine-http-413": number;
    "azure-auth": number;
    "pixel-limit": number;
    other: number;
  };
  rows: Array<{
    sourceRow: number;
    sourceId: string;
    status: "created" | "updated" | "unchanged" | "skipped" | "conflict" | "error";
    productPublicId: string | null;
    reason: string | null;
  }>;
};

export type MenuExtractionUncertainty =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "missing"
  | "contradictory";

export type MenuExtractionBBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MenuExtractionSourceEvidence = {
  pageNumber: number;
  bbox: MenuExtractionBBox | null;
  originalText: string | null;
};

export type MenuExtractionCandidatePayload = {
  schema: "qos.catalogue_menu_extraction_candidate.v1";
  candidateKey: string;
  sectionName: string | null;
  displayNameEn: string | null;
  displayNameAr: string | null;
  descriptionEn: string | null;
  descriptionAr: string | null;
  variantLabelEn: string | null;
  variantLabelAr: string | null;
  priceText: string | null;
  amountMinor: number | null;
  currency: string | null;
  allergenText: string | null;
  unitText: string | null;
  uncertainty: {
    displayNameEn: MenuExtractionUncertainty;
    displayNameAr: MenuExtractionUncertainty;
    descriptionEn: MenuExtractionUncertainty;
    descriptionAr: MenuExtractionUncertainty;
    price: MenuExtractionUncertainty;
    allergen: MenuExtractionUncertainty;
    unit: MenuExtractionUncertainty;
  };
  evidence: MenuExtractionSourceEvidence;
  modelConfidenceEstimate: string | null;
};

export const catalogueImportSourceLinks = qos.table(
  "catalogue_import_source_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    connectionKey: text("connection_key").notNull(),
    sourceId: text("source_id").notNull(),
    productId: uuid("product_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [catalogueProducts.tenantId, catalogueProducts.id],
    }).onDelete("restrict"),
    unique("catalogue_import_source_links_unique").on(
      table.tenantId,
      table.connectionKey,
      table.sourceId,
    ),
    index("catalogue_import_source_links_tenant_id_idx").on(table.tenantId),
  ],
);

export const catalogueImportOperations = qos.table(
  "catalogue_import_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    operationPublicId: text("operation_public_id").notNull(),
    staffSubject: text("staff_subject").notNull(),
    connectionKey: text("connection_key").notNull(),
    fileName: text("file_name").notNull(),
    fileFingerprint: text("file_fingerprint").notNull(),
    columnMapping: jsonb("column_mapping")
      .$type<CatalogueImportColumnMapping>()
      .notNull(),
    previewPayload: jsonb("preview_payload")
      .$type<CatalogueImportPreviewPayload>()
      .notNull(),
    previewHash: text("preview_hash").notNull(),
    status: catalogueImportOperationStatusEnum("status").notNull(),
    applyReport: jsonb("apply_report").$type<CatalogueImportApplyReport>(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    unique("catalogue_import_operations_public_id_unique").on(
      table.tenantId,
      table.operationPublicId,
    ),
    unique("catalogue_import_operations_idempotency_unique").on(
      table.tenantId,
      table.idempotencyKey,
    ),
    index("catalogue_import_operations_tenant_id_idx").on(table.tenantId),
  ],
);

/* QOS-194 persisted workbook review plans (migration 0055). Review only:
   QOS-217 consumes a plan after recomputing its plan_hash. The jsonb shapes
   are type-only imports from the review engine's model. */
export const workbookImportPlans = qos.table(
  "workbook_import_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    publicId: text("public_id").notNull(),
    revision: integer("revision").notNull().default(1),
    status: text("status").$type<PlanStatus>().notNull(),
    sourceProfile: text("source_profile").$type<ReviewSourceProfile>().notNull(),
    templateVersion: text("template_version").notNull(),
    dictionaryVersion: text("dictionary_version"),
    brandId: uuid("brand_id").notNull(),
    sourceNamespace: text("source_namespace").notNull(),
    keysVerified: boolean("keys_verified").notNull(),
    fileName: text("file_name").notNull(),
    fileFingerprint: text("file_fingerprint").notNull(),
    sourceFileSha256: text("source_file_sha256"),
    exportRevision: text("export_revision"),
    snapshotHash: text("snapshot_hash").notNull(),
    planHash: text("plan_hash").notNull(),
    engineVersion: text("engine_version").notNull(),
    createdBySubject: text("created_by_subject").notNull(),
    createdByRole: text("created_by_role").$type<"administrator" | "user">().notNull(),
    reviewedBySubject: text("reviewed_by_subject").notNull(),
    branchScope: jsonb("branch_scope").$type<"all" | string[]>().notNull(),
    context: jsonb("context").$type<StoredPlanContext>().notNull(),
    counts: jsonb("counts").$type<ReviewCounts>().notNull(),
    decisions: jsonb("decisions").$type<PlanAcknowledgement[]>().notNull().default([]),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "workbook_import_plans_brand_fk",
      columns: [table.tenantId, table.brandId],
      foreignColumns: [brands.tenantId, brands.id],
    }).onDelete("restrict"),
    uniqueIndex("workbook_import_plans_public_unique").on(table.tenantId, table.publicId),
    uniqueIndex("workbook_import_plans_tenant_id_id_unique").on(table.tenantId, table.id),
    uniqueIndex("workbook_import_plans_idempotency_unique").on(table.tenantId, table.idempotencyKey),
    index("workbook_import_plans_tenant_id_idx").on(table.tenantId),
    check("workbook_import_plans_status_check", sql`${table.status} IN ('review_ready','stale','applying','applied','apply_failed')`),
    check("workbook_import_plans_profile_check", sql`${table.sourceProfile} IN ('qos_extended_v1','foodics_menu_v1')`),
    check("workbook_import_plans_role_check", sql`${table.createdByRole} IN ('administrator','user')`),
    check("workbook_import_plans_revision_check", sql`${table.revision} >= 1`),
  ],
);

export const workbookImportPlanRows = qos.table(
  "workbook_import_plan_rows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    planId: uuid("plan_id").notNull(),
    sheet: text("sheet").notNull(),
    rowNumber: integer("row_number").notNull(),
    entityKey: text("entity_key").notNull(),
    requestedAction: text("requested_action").notNull(),
    classification: text("classification").$type<ReviewClassification>().notNull(),
    operation: text("operation").$type<ReviewOperation>(),
    targetPublicId: text("target_public_id"),
    targetRevision: text("target_revision"),
    values: jsonb("values").$type<Record<string, string>>().notNull(),
    before: jsonb("before").$type<Record<string, string>>(),
    after: jsonb("after").$type<Record<string, string>>(),
    changes: jsonb("changes").$type<ReviewChange[]>().notNull().default([]),
    deferredFields: jsonb("deferred_fields").$type<ReviewDeferredField[]>().notNull().default([]),
    diagnostics: jsonb("diagnostics").$type<ReviewDiagnostic[]>().notNull().default([]),
    dependencies: jsonb("dependencies").$type<ReviewDependencies>().notNull().default({ blockedBy: [], blocks: [] }),
    detail: jsonb("detail").$type<ReviewRowDetail>().notNull(),
    provenance: jsonb("provenance").$type<ReviewProvenance>(),
    decision: jsonb("decision").$type<RowDecision>(),
    applyState: text("apply_state").$type<RowApplyState>(),
    appliedPublicId: text("applied_public_id"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    applyId: uuid("apply_id"),
    applyError: jsonb("apply_error").$type<ApplyFailure>(),
    applyResult: jsonb("apply_result").$type<RowApplyResult>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "workbook_import_plan_rows_plan_fk",
      columns: [table.tenantId, table.planId],
      foreignColumns: [workbookImportPlans.tenantId, workbookImportPlans.id],
    }).onDelete("restrict"),
    uniqueIndex("workbook_import_plan_rows_unique").on(table.tenantId, table.planId, table.sheet, table.rowNumber),
    index("workbook_import_plan_rows_plan_idx").on(table.tenantId, table.planId),
    index("workbook_import_plan_rows_tenant_id_idx").on(table.tenantId),
    check("workbook_import_plan_rows_row_check", sql`${table.rowNumber} >= 1`),
    check(
      "workbook_import_plan_rows_classification_check",
      sql`${table.classification} IN ('create','update','unchanged','skipped','conflicting','invalid','blocked','unsupported')`,
    ),
    check(
      "workbook_import_plan_rows_operation_check",
      sql`${table.operation} IS NULL OR ${table.operation} IN ('create','update','archive','restore','remove_link','reset_to_central')`,
    ),
    check(
      "workbook_import_plan_rows_apply_state_check",
      sql`${table.applyState} IS NULL OR ${table.applyState} IN ('pending','applied','already_applied','failed','not_applied','deferred_only')`,
    ),
  ],
);

/* QOS-217 workbook apply (migration 0058): one row per apply attempt
   (idempotency, history, heartbeat for recovery) and typed source links
   (workbook key → QOS public id per entity type and namespace). */
export const workbookImportApplies = qos.table(
  "workbook_import_applies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    planId: uuid("plan_id").notNull(),
    publicId: text("public_id").notNull(),
    status: text("status").$type<ApplyStatus>().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    planRevision: integer("plan_revision").notNull(),
    planHash: text("plan_hash").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    engineVersion: text("engine_version").notNull(),
    sourceProfile: text("source_profile").notNull(),
    sourceNamespace: text("source_namespace").notNull(),
    templateVersion: text("template_version").notNull(),
    dictionaryVersion: text("dictionary_version"),
    branchScope: jsonb("branch_scope").$type<"all" | string[]>().notNull(),
    actorSubject: text("actor_subject").notNull(),
    actorRole: text("actor_role").$type<"administrator" | "user">().notNull(),
    counts: jsonb("counts").$type<Partial<ApplyCounts>>().notNull().default({}),
    summary: jsonb("summary").$type<ApplySummary>().notNull().default({}),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "workbook_import_applies_plan_fk",
      columns: [table.tenantId, table.planId],
      foreignColumns: [workbookImportPlans.tenantId, workbookImportPlans.id],
    }).onDelete("restrict"),
    uniqueIndex("workbook_import_applies_public_unique").on(table.tenantId, table.publicId),
    uniqueIndex("workbook_import_applies_tenant_id_id_unique").on(table.tenantId, table.id),
    uniqueIndex("workbook_import_applies_idempotency_unique").on(table.tenantId, table.idempotencyKey),
    uniqueIndex("workbook_import_applies_one_running_per_plan")
      .on(table.tenantId, table.planId)
      .where(sql`${table.status} = 'applying'`),
    index("workbook_import_applies_plan_idx").on(table.tenantId, table.planId, table.startedAt),
    index("workbook_import_applies_tenant_id_idx").on(table.tenantId),
    check("workbook_import_applies_status_check", sql`${table.status} IN ('applying','completed','failed','interrupted')`),
    check("workbook_import_applies_role_check", sql`${table.actorRole} IN ('administrator','user')`),
  ],
);

export const workbookSourceLinks = qos.table(
  "workbook_source_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    sourceNamespace: text("source_namespace").notNull(),
    entityType: text("entity_type").$type<TypedLinkEntity>().notNull(),
    sourceKey: text("source_key").notNull(),
    targetPublicId: text("target_public_id").notNull(),
    planId: uuid("plan_id"),
    applyId: uuid("apply_id"),
    createdBySubject: text("created_by_subject").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "workbook_source_links_plan_fk",
      columns: [table.tenantId, table.planId],
      foreignColumns: [workbookImportPlans.tenantId, workbookImportPlans.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "workbook_source_links_apply_fk",
      columns: [table.tenantId, table.applyId],
      foreignColumns: [workbookImportApplies.tenantId, workbookImportApplies.id],
    }).onDelete("restrict"),
    uniqueIndex("workbook_source_links_source_unique").on(table.tenantId, table.sourceNamespace, table.entityType, table.sourceKey),
    uniqueIndex("workbook_source_links_target_unique").on(table.tenantId, table.sourceNamespace, table.entityType, table.targetPublicId),
    index("workbook_source_links_tenant_id_idx").on(table.tenantId),
    check(
      "workbook_source_links_entity_check",
      sql`${table.entityType} IN ('category','product','variant','modifier_group','modifier_option','menu','menu_section')`,
    ),
  ],
);

export const catalogueMenuExtractionSourceStatusEnum = qos.enum(
  "catalogue_menu_extraction_source_status",
  ["ready", "failed"],
);

export const catalogueMenuExtractionSources = qos.table(
  "catalogue_menu_extraction_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    publicId: text("public_id").notNull(),
    contentHash: text("content_hash").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    originalStoragePath: text("original_storage_path").notNull(),
    pageCount: integer("page_count").notNull(),
    status: catalogueMenuExtractionSourceStatusEnum("status").notNull(),
    uploadedBySubject: text("uploaded_by_subject").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("catalogue_menu_extraction_sources_public_unique").on(
      table.tenantId,
      table.publicId,
    ),
    unique("catalogue_menu_extraction_sources_content_hash_unique").on(
      table.tenantId,
      table.contentHash,
    ),
    unique("catalogue_menu_extraction_sources_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    index("catalogue_menu_extraction_sources_tenant_id_idx").on(table.tenantId),
  ],
);

export const catalogueMenuExtractionPages = qos.table(
  "catalogue_menu_extraction_pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    sourceId: uuid("source_id").notNull(),
    pageNumber: integer("page_number").notNull(),
    storagePath: text("storage_path").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    contentHash: text("content_hash").notNull(),
  },
  (table) => [
    foreignKey({
      name: "catalogue_menu_extraction_pages_source_fk",
      columns: [table.tenantId, table.sourceId],
      foreignColumns: [
        catalogueMenuExtractionSources.tenantId,
        catalogueMenuExtractionSources.id,
      ],
    }).onDelete("restrict"),
    unique("catalogue_menu_extraction_pages_source_page_unique").on(
      table.tenantId,
      table.sourceId,
      table.pageNumber,
    ),
    index("catalogue_menu_extraction_pages_tenant_id_idx").on(table.tenantId),
  ],
);

export const businessProvisioningOperations = qos.table(
  "business_provisioning_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    operatorSubject: text("operator_subject").notNull(),
    status: provisioningOperationStatusEnum("status")
      .notNull()
      .default("pending"),
    tenantId: uuid("tenant_id").references(() => tenants.id, {
      onDelete: "restrict",
    }),
    resultSnapshot: text("result_snapshot"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("business_provisioning_operations_idempotency_key_unique").on(
      table.idempotencyKey,
    ),
    index("business_provisioning_operations_tenant_id_idx").on(table.tenantId),
  ],
);

export const staffLocationScopes = qos.table(
  "staff_location_scopes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    staffMembershipId: uuid("staff_membership_id").notNull(),
    locationId: uuid("location_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.staffMembershipId],
      foreignColumns: [staffMemberships.tenantId, staffMemberships.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [locations.tenantId, locations.id],
    }).onDelete("restrict"),
    unique("staff_location_scopes_membership_location_unique").on(
      table.staffMembershipId,
      table.locationId,
    ),
    index("staff_location_scopes_tenant_id_idx").on(table.tenantId),
  ],
);

export const tenantsRelations = relations(tenants, ({ many }) => ({
  organizations: many(organizations),
  staffMemberships: many(staffMemberships),
  staffInvitations: many(staffInvitations),
  staffAccessRequests: many(staffAccessRequests),
}));

export const organizationsRelations = relations(
  organizations,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [organizations.tenantId],
      references: [tenants.id],
    }),
    brands: many(brands),
  }),
);

export const brandsRelations = relations(brands, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [brands.tenantId, brands.organizationId],
    references: [organizations.tenantId, organizations.id],
  }),
  locations: many(locations),
}));

export const locationsRelations = relations(locations, ({ one, many }) => ({
  brand: one(brands, {
    fields: [locations.tenantId, locations.brandId],
    references: [brands.tenantId, brands.id],
  }),
  staffLocationScopes: many(staffLocationScopes),
  externalMenuSources: many(locationExternalMenuSources),
}));

export const agentProviderEnum = qos.enum("agent_provider", ["hyperagent", "agents_sdk"]);

export const agentProviderConnectionStatusEnum = qos.enum(
  "agent_provider_connection_status",
  ["disconnected", "connected", "needs_reauth", "error"],
);

export const agentCapabilityEnum = qos.enum("agent_capability", [
  "menu_manager",
  "catalogue_translation",
  "catalogue_description",
  "catalogue_menu_extraction",
]);

export const agentRunStatusEnum = qos.enum("agent_run_status", [
  "queued",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
]);

/**
 * Platform-scoped: one QOS-owned connection per provider, no tenant_id.
 * Readable by the runtime for status; writable only under the agent platform
 * admin setting. Secrets live in `agent_provider_credentials`.
 */
export const agentProviderConnections = qos.table(
  "agent_provider_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: agentProviderEnum("provider").notNull(),
    status: agentProviderConnectionStatusEnum("status")
      .notNull()
      .default("disconnected"),
    serverUrl: text("server_url").notNull(),
    accountLabel: text("account_label"),
    connectedBySubject: text("connected_by_subject"),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("agent_provider_connections_provider_unique").on(table.provider),
  ],
);

/**
 * Encrypted provider OAuth material. Only visible to the runtime inside a
 * transaction that sets the agent credential access setting.
 */
export const agentProviderCredentials = qos.table(
  "agent_provider_credentials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => agentProviderConnections.id, { onDelete: "cascade" }),
    ciphertext: text("ciphertext").notNull(),
    keyFingerprint: text("key_fingerprint").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("agent_provider_credentials_connection_unique").on(
      table.connectionId,
    ),
  ],
);

/**
 * The platform-approved provider agent for a tenant capability. Tenants may
 * only toggle `enabled`; a trigger rejects any other change outside the agent
 * platform admin setting.
 */
export const tenantAgentBindings = qos.table(
  "tenant_agent_bindings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    publicId: text("public_id").notNull(),
    capability: agentCapabilityEnum("capability").notNull(),
    provider: agentProviderEnum("provider").notNull(),
    providerAgentId: text("provider_agent_id").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    approvedBySubject: text("approved_by_subject").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    enabledChangedBySubject: text("enabled_changed_by_subject"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("tenant_agent_bindings_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    unique("tenant_agent_bindings_public_id_unique").on(
      table.tenantId,
      table.publicId,
    ),
    unique("tenant_agent_bindings_capability_unique").on(
      table.tenantId,
      table.capability,
    ),
    index("tenant_agent_bindings_tenant_id_idx").on(table.tenantId),
  ],
);

export type AgentRunRequestSummary = Record<string, unknown>;

/** Persisted shape of `agent_runs.execution_identity` (see `src/lib/ai/execution-identity.ts`). */
export type AgentRunExecutionIdentity = {
  executorKind: string;
  executorAdapter: string;
  adapterVersion: string;
  modelProvider: string | null;
  modelId: string | null;
};

export const agentRuns = qos.table(
  "agent_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    publicId: text("public_id").notNull(),
    bindingId: uuid("binding_id"),
    capability: agentCapabilityEnum("capability").notNull(),
    provider: agentProviderEnum("provider").notNull(),
    providerAgentId: text("provider_agent_id").notNull(),
    providerThreadId: text("provider_thread_id"),
    status: agentRunStatusEnum("status").notNull().default("queued"),
    subjectType: text("subject_type").notNull(),
    subjectPublicId: text("subject_public_id").notNull(),
    subjectVersion: integer("subject_version"),
    requestedBySubject: text("requested_by_subject").notNull(),
    requestedByActorClass: auditActorClassEnum("requested_by_actor_class").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    requestSummary: jsonb("request_summary")
      .$type<AgentRunRequestSummary>()
      .notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    rawResultExcerpt: text("raw_result_excerpt"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    pollLeaseOwner: text("poll_lease_owner"),
    pollLeaseExpiresAt: timestamp("poll_lease_expires_at", { withTimezone: true }),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    nextPollAt: timestamp("next_poll_at", { withTimezone: true }),
    pollCount: integer("poll_count").notNull().default(0),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Pins; NULL only on rows created before migration 0040. */
    definitionKey: text("definition_key"),
    definitionVersion: text("definition_version"),
    executionIdentity: jsonb("execution_identity").$type<AgentRunExecutionIdentity>(),
    runConfig: jsonb("run_config").$type<Record<string, unknown>>(),
    /** 'inline' or 'queued_worker'; NULL only on rows created before 0042 (inline). Immutable. */
    executionMode: text("execution_mode").$type<"inline" | "queued_worker">(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.bindingId],
      foreignColumns: [tenantAgentBindings.tenantId, tenantAgentBindings.id],
    }).onDelete("restrict"),
    check(
      "agent_runs_pin_complete",
      sql`(${table.definitionKey} IS NULL AND ${table.definitionVersion} IS NULL AND ${table.executionIdentity} IS NULL AND ${table.runConfig} IS NULL) OR (${table.definitionKey} IS NOT NULL AND ${table.definitionVersion} IS NOT NULL AND ${table.executionIdentity} IS NOT NULL AND ${table.runConfig} IS NOT NULL)`,
    ),
    check(
      "agent_runs_binding_for_provider",
      sql`(${table.provider} = 'hyperagent' AND ${table.bindingId} IS NOT NULL) OR (${table.provider} <> 'hyperagent')`,
    ),
    unique("agent_runs_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("agent_runs_public_id_unique").on(table.tenantId, table.publicId),
    unique("agent_runs_idempotency_unique").on(
      table.tenantId,
      table.idempotencyKey,
    ),
    uniqueIndex("agent_runs_one_active_per_subject")
      .on(
        table.tenantId,
        table.capability,
        table.subjectType,
        table.subjectPublicId,
      )
      .where(sql`status in ('queued', 'running')`),
    index("agent_runs_tenant_subject_idx").on(
      table.tenantId,
      table.subjectType,
      table.subjectPublicId,
      table.createdAt,
    ),
  ],
);

export const catalogueMenuExtractionCandidates = qos.table(
  "catalogue_menu_extraction_candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    agentRunId: uuid("agent_run_id").notNull(),
    candidateKey: text("candidate_key").notNull(),
    sectionName: text("section_name"),
    payload: jsonb("payload").$type<MenuExtractionCandidatePayload>().notNull(),
    excluded: boolean("excluded").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "catalogue_menu_extraction_candidates_run_fk",
      columns: [table.tenantId, table.agentRunId],
      foreignColumns: [agentRuns.tenantId, agentRuns.id],
    }).onDelete("restrict"),
    unique("catalogue_menu_extraction_candidates_run_key_unique").on(
      table.tenantId,
      table.agentRunId,
      table.candidateKey,
    ),
    index("catalogue_menu_extraction_candidates_tenant_id_idx").on(table.tenantId),
  ],
);

/** One person-applied Menu Manager suggestion; immutable for idempotent replay. */
export const agentRunCatalogueTranslationDecisions = qos.table(
  "agent_run_catalogue_translation_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    agentRunId: uuid("agent_run_id").notNull(),
    decision: text("decision").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    decidedBySubject: text("decided_by_subject").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "agent_run_catalogue_translation_decisions_run_fk",
      columns: [table.tenantId, table.agentRunId],
      foreignColumns: [agentRuns.tenantId, agentRuns.id],
    }).onDelete("restrict"),
    uniqueIndex("agent_run_catalogue_translation_decisions_run_unique").on(
      table.tenantId,
      table.agentRunId,
    ),
  ],
);

/** One accept/reject decision for an AI English description draft suggestion. */
export const agentRunCatalogueDescriptionDecisions = qos.table(
  "agent_run_catalogue_description_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    agentRunId: uuid("agent_run_id").notNull(),
    decision: text("decision").notNull(),
    description: text("description"),
    decidedBySubject: text("decided_by_subject").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "agent_run_catalogue_description_decisions_run_fk",
      columns: [table.tenantId, table.agentRunId],
      foreignColumns: [agentRuns.tenantId, agentRuns.id],
    }).onDelete("restrict"),
    uniqueIndex("agent_run_catalogue_description_decisions_run_unique").on(
      table.tenantId,
      table.agentRunId,
    ),
  ],
);

export const agentRunCatalogueMenuExtractionDecisions = qos.table(
  "agent_run_catalogue_menu_extraction_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    agentRunId: uuid("agent_run_id").notNull(),
    decision: text("decision").notNull(),
    importOperationPublicId: text("import_operation_public_id"),
    decidedBySubject: text("decided_by_subject").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "agent_run_catalogue_menu_extraction_decisions_run_fk",
      columns: [table.tenantId, table.agentRunId],
      foreignColumns: [agentRuns.tenantId, agentRuns.id],
    }).onDelete("restrict"),
    uniqueIndex("agent_run_catalogue_menu_extraction_decisions_run_unique").on(
      table.tenantId,
      table.agentRunId,
    ),
  ],
);

/** One person-applied Menu Manager suggestion; immutable for idempotent replay. */
export const agentRunMenuManagerSuggestionAcceptances = qos.table(
  "agent_run_menu_manager_suggestion_acceptances",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    agentRunId: uuid("agent_run_id").notNull(),
    productPublicId: text("product_public_id").notNull(),
    field: text("field").notNull(),
    proposedText: text("proposed_text").notNull(),
    acceptedBySubject: text("accepted_by_subject").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "agent_run_menu_manager_suggestion_acceptances_run_fk",
      columns: [table.tenantId, table.agentRunId],
      foreignColumns: [agentRuns.tenantId, agentRuns.id],
    }).onDelete("restrict"),
    uniqueIndex("agent_run_menu_manager_suggestion_acceptances_identity_unique").on(
      table.tenantId,
      table.agentRunId,
      table.productPublicId,
      table.field,
      table.proposedText,
    ),
  ],
);

/**
 * The exact bounded input text a run was accepted with. Immutable; never
 * copied into audit metadata. Text rather than jsonb so the checksum can be
 * re-verified byte for byte.
 */
export const agentRunInputs = qos.table(
  "agent_run_inputs",
  {
    runId: uuid("run_id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    inputSchema: text("input_schema").notNull(),
    payload: text("payload").notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "agent_run_inputs_run_fk",
      columns: [table.tenantId, table.runId],
      foreignColumns: [agentRuns.tenantId, agentRuns.id],
    }).onDelete("restrict"),
    check("agent_run_inputs_sha256_format", sql`${table.payloadSha256} ~ '^[0-9a-f]{64}$'`),
    check(
      "agent_run_inputs_payload_size",
      sql`octet_length(${table.payload}) BETWEEN 1 AND 1048576`,
    ),
  ],
);

/**
 * One admission reservation per subject and paid path. Units are the quota
 * measure; estimated cost exists only with versioned pricing; reported usage
 * is kept apart; "uncertain" is potentially billed work with an unknown
 * outcome. Lifecycle and immutability are enforced by a trigger.
 */
export const aiSpendReservations = qos.table(
  "ai_spend_reservations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    publicId: text("public_id").notNull(),
    path: text("path").notNull(),
    provider: text("provider").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectPublicId: text("subject_public_id").notNull(),
    units: integer("units").notNull(),
    estimatedCostMicros: bigint("estimated_cost_micros", { mode: "number" }),
    pricingVersion: text("pricing_version"),
    state: text("state").notNull().default("reserved"),
    dailyWindow: date("daily_window").notNull(),
    monthlyWindow: date("monthly_window").notNull(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    outcome: text("outcome"),
    reportedUsage: jsonb("reported_usage"),
    resolution: text("resolution"),
    resolvedBySubject: text("resolved_by_subject"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    unique("ai_spend_reservations_public_id_unique").on(table.tenantId, table.publicId),
    unique("ai_spend_reservations_subject_unique").on(
      table.tenantId,
      table.path,
      table.subjectType,
      table.subjectPublicId,
    ),
    check("ai_spend_reservations_units_positive", sql`${table.units} > 0`),
    check(
      "ai_spend_reservations_state",
      sql`${table.state} IN ('reserved', 'consumed', 'released', 'uncertain')`,
    ),
  ],
);

export const aiSpendTenantCounters = qos.table(
  "ai_spend_tenant_counters",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    scopeKey: text("scope_key").notNull(),
    windowStart: date("window_start").notNull(),
    units: integer("units").notNull().default(0),
  },
  (table) => [
    primaryKey({
      name: "ai_spend_tenant_counters_pk",
      columns: [table.tenantId, table.scopeKey, table.windowStart],
    }),
  ],
);

/** Platform and provider aggregates only; holds no tenant data. */
export const aiSpendPlatformCounters = qos.table(
  "ai_spend_platform_counters",
  {
    scopeKey: text("scope_key").notNull(),
    windowStart: date("window_start").notNull(),
    units: integer("units").notNull().default(0),
  },
  (table) => [
    primaryKey({
      name: "ai_spend_platform_counters_pk",
      columns: [table.scopeKey, table.windowStart],
    }),
  ],
);

/**
 * Durable AI work. One job per run and kind; a lease token fences every
 * worker write. Claims happen only through qos.claim_next_ai_job.
 */
export const aiJobs = qos.table(
  "ai_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    publicId: text("public_id").notNull(),
    jobKind: text("job_kind").notNull(),
    agentRunId: uuid("agent_run_id"),
    mediaAssetId: uuid("media_asset_id"),
    status: text("status")
      .$type<"queued" | "leased" | "completed" | "failed" | "cancelled" | "operator_review">()
      .notNull()
      .default("queued"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    leaseToken: uuid("lease_token"),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastClaimedAt: timestamp("last_claimed_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    unique("ai_jobs_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("ai_jobs_public_id_unique").on(table.tenantId, table.publicId),
    unique("ai_jobs_run_kind_unique").on(table.tenantId, table.jobKind, table.agentRunId),
    foreignKey({
      name: "ai_jobs_run_fk",
      columns: [table.tenantId, table.agentRunId],
      foreignColumns: [agentRuns.tenantId, agentRuns.id],
    }).onDelete("restrict"),
    unique("ai_jobs_asset_kind_unique").on(table.tenantId, table.jobKind, table.mediaAssetId),
    foreignKey({
      name: "ai_jobs_media_asset_fk",
      columns: [table.tenantId, table.mediaAssetId],
      foreignColumns: [catalogueMediaAssets.tenantId, catalogueMediaAssets.id],
    }).onDelete("restrict"),
    check("ai_jobs_one_subject", sql`num_nonnulls(${table.agentRunId}, ${table.mediaAssetId}) = 1`),
    index("ai_jobs_due_idx").on(table.status, table.nextAttemptAt),
    index("ai_jobs_tenant_status_idx").on(table.tenantId, table.status),
  ],
);

/** Evidence per lease: dispatch time, outcome and what the provider outcome proved. */
export const aiJobAttempts = qos.table(
  "ai_job_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    jobId: uuid("job_id").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    leaseToken: uuid("lease_token").notNull(),
    workerId: text("worker_id").notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    outcome: text("outcome").$type<
      "completed" | "rescheduled" | "failed" | "operator_review" | "lease_expired"
    >(),
    providerOutcome: text("provider_outcome"),
    errorCode: text("error_code"),
  },
  (table) => [
    unique("ai_job_attempts_lease_token_unique").on(table.leaseToken),
    unique("ai_job_attempts_number_unique").on(table.jobId, table.attemptNumber),
    foreignKey({
      name: "ai_job_attempts_job_fk",
      columns: [table.tenantId, table.jobId],
      foreignColumns: [aiJobs.tenantId, aiJobs.id],
    }).onDelete("restrict"),
  ],
);

/* QOS-195 inventory units, items and item-scoped unit conversions (0060).
   Units and items are edited in place with a version bump; conversions are
   append-only version rows (qos_app may only set effective_to). */
export const inventoryUnits = qos.table(
  "inventory_units",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    publicId: text("public_id").notNull(),
    code: text("code").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    quantityKind: text("quantity_kind").notNull().$type<"mass" | "volume" | "count" | "pack">(),
    standardCode: text("standard_code").$type<"mg" | "g" | "kg" | "ml" | "cl" | "l" | "piece">(),
    decimalPlaces: integer("decimal_places").notNull(),
    status: text("status").notNull().default("active").$type<"active" | "archived">(),
    version: integer("version").notNull().default(1),
    provenance: dataProvenanceEnum("provenance").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBySubject: text("created_by_subject"),
    updatedBySubject: text("updated_by_subject"),
  },
  (table) => [
    unique("inventory_units_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("inventory_units_tenant_public_id_unique").on(table.tenantId, table.publicId),
    unique("inventory_units_tenant_code_unique").on(table.tenantId, table.code),
    uniqueIndex("inventory_units_tenant_standard_code_unique")
      .on(table.tenantId, table.standardCode)
      .where(sql`standard_code IS NOT NULL`),
    index("inventory_units_tenant_id_idx").on(table.tenantId),
    check("inventory_units_public_id_check", sql`${table.publicId} ~ '^unit_[a-z0-9_-]+$'`),
    check("inventory_units_code_check", sql`${table.code} ~ '^[a-z0-9][a-z0-9_-]{0,23}$'`),
    check("inventory_units_name_en_check", sql`char_length(btrim(${table.nameEn})) BETWEEN 1 AND 80`),
    check("inventory_units_name_ar_check", sql`char_length(btrim(${table.nameAr})) BETWEEN 1 AND 80`),
    check(
      "inventory_units_quantity_kind_check",
      sql`${table.quantityKind} IN ('mass', 'volume', 'count', 'pack')`,
    ),
    check(
      "inventory_units_standard_code_check",
      sql`${table.standardCode} IS NULL OR ${table.standardCode} IN ('mg', 'g', 'kg', 'ml', 'cl', 'l', 'piece')`,
    ),
    check("inventory_units_decimal_places_check", sql`${table.decimalPlaces} BETWEEN 0 AND 6`),
    check("inventory_units_status_check", sql`${table.status} IN ('active', 'archived')`),
    check("inventory_units_version_check", sql`${table.version} >= 1`),
  ],
);

/* QOS-196 suppliers (0061). Identity is the public id; names are not unique,
   so two rows with the same name are two suppliers. Archive only. */
export const inventorySuppliers = qos.table(
  "inventory_suppliers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    publicId: text("public_id").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar"),
    code: text("code"),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    notes: text("notes"),
    status: text("status").notNull().default("active").$type<"active" | "archived">(),
    version: integer("version").notNull().default(1),
    provenance: dataProvenanceEnum("provenance").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBySubject: text("created_by_subject"),
    updatedBySubject: text("updated_by_subject"),
  },
  (table) => [
    unique("inventory_suppliers_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("inventory_suppliers_tenant_public_id_unique").on(table.tenantId, table.publicId),
    uniqueIndex("inventory_suppliers_tenant_code_unique")
      .on(table.tenantId, sql`lower(${table.code})`)
      .where(sql`code IS NOT NULL`),
    index("inventory_suppliers_tenant_id_idx").on(table.tenantId),
    check("inventory_suppliers_public_id_check", sql`${table.publicId} ~ '^sup_[a-z0-9_-]+$'`),
    check("inventory_suppliers_name_en_check", sql`char_length(btrim(${table.nameEn})) BETWEEN 1 AND 120`),
    check(
      "inventory_suppliers_name_ar_check",
      sql`${table.nameAr} IS NULL OR char_length(btrim(${table.nameAr})) BETWEEN 1 AND 120`,
    ),
    check(
      "inventory_suppliers_code_check",
      sql`${table.code} IS NULL OR ${table.code} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$'`,
    ),
    check(
      "inventory_suppliers_contact_name_check",
      sql`${table.contactName} IS NULL OR char_length(${table.contactName}) <= 120`,
    ),
    check("inventory_suppliers_phone_check", sql`${table.phone} IS NULL OR char_length(${table.phone}) <= 40`),
    check("inventory_suppliers_email_check", sql`${table.email} IS NULL OR char_length(${table.email}) <= 254`),
    check("inventory_suppliers_address_check", sql`${table.address} IS NULL OR char_length(${table.address}) <= 400`),
    check("inventory_suppliers_notes_check", sql`${table.notes} IS NULL OR char_length(${table.notes}) <= 1000`),
    check("inventory_suppliers_status_check", sql`${table.status} IN ('active', 'archived')`),
    check("inventory_suppliers_version_check", sql`${table.version} >= 1`),
  ],
);

/* QOS-197 inventory categories (0062). Flat; identity is the public id. At
   most one active category per tenant has a given English name (case and
   outer spaces ignored). Archive only. */
export const inventoryCategories = qos.table(
  "inventory_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    publicId: text("public_id").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar"),
    status: text("status").notNull().default("active").$type<"active" | "archived">(),
    version: integer("version").notNull().default(1),
    provenance: dataProvenanceEnum("provenance").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBySubject: text("created_by_subject"),
    updatedBySubject: text("updated_by_subject"),
  },
  (table) => [
    unique("inventory_categories_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("inventory_categories_tenant_public_id_unique").on(table.tenantId, table.publicId),
    uniqueIndex("inventory_categories_active_name_unique")
      .on(table.tenantId, sql`lower(btrim(${table.nameEn}))`)
      .where(sql`status = 'active'`),
    index("inventory_categories_tenant_id_idx").on(table.tenantId),
    check("inventory_categories_public_id_check", sql`${table.publicId} ~ '^invcat_[a-z0-9_-]+$'`),
    check("inventory_categories_name_en_check", sql`char_length(btrim(${table.nameEn})) BETWEEN 1 AND 120`),
    check(
      "inventory_categories_name_ar_check",
      sql`${table.nameAr} IS NULL OR char_length(btrim(${table.nameAr})) BETWEEN 1 AND 120`,
    ),
    check("inventory_categories_status_check", sql`${table.status} IN ('active', 'archived')`),
    check("inventory_categories_version_check", sql`${table.version} >= 1`),
  ],
);

export const inventoryItems = qos.table(
  "inventory_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    publicId: text("public_id").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar"),
    kind: text("kind").notNull().$type<"purchased" | "prepared">(),
    storageUnitId: uuid("storage_unit_id"),
    recipeUnitId: uuid("recipe_unit_id"),
    purchaseUnitId: uuid("purchase_unit_id"),
    /** QOS-196: the supplier proposed on a direct receipt of this item. */
    defaultSupplierId: uuid("default_supplier_id"),
    /** QOS-197: optional flat inventory category (composite FK, same tenant). */
    categoryId: uuid("category_id"),
    /** QOS-197: preparation or procurement notes. */
    notes: text("notes"),
    status: text("status").notNull().default("active").$type<"active" | "archived">(),
    version: integer("version").notNull().default(1),
    provenance: dataProvenanceEnum("provenance").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBySubject: text("created_by_subject"),
    updatedBySubject: text("updated_by_subject"),
  },
  (table) => [
    unique("inventory_items_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("inventory_items_tenant_public_id_unique").on(table.tenantId, table.publicId),
    foreignKey({
      name: "inventory_items_storage_unit_fk",
      columns: [table.tenantId, table.storageUnitId],
      foreignColumns: [inventoryUnits.tenantId, inventoryUnits.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "inventory_items_recipe_unit_fk",
      columns: [table.tenantId, table.recipeUnitId],
      foreignColumns: [inventoryUnits.tenantId, inventoryUnits.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "inventory_items_purchase_unit_fk",
      columns: [table.tenantId, table.purchaseUnitId],
      foreignColumns: [inventoryUnits.tenantId, inventoryUnits.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "inventory_items_default_supplier_fk",
      columns: [table.tenantId, table.defaultSupplierId],
      foreignColumns: [inventorySuppliers.tenantId, inventorySuppliers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "inventory_items_category_fk",
      columns: [table.tenantId, table.categoryId],
      foreignColumns: [inventoryCategories.tenantId, inventoryCategories.id],
    }).onDelete("restrict"),
    index("inventory_items_tenant_id_idx").on(table.tenantId),
    index("inventory_items_tenant_default_supplier_idx").on(table.tenantId, table.defaultSupplierId),
    index("inventory_items_tenant_category_idx").on(table.tenantId, table.categoryId),
    check("inventory_items_notes_check", sql`${table.notes} IS NULL OR char_length(${table.notes}) <= 1000`),
    check("inventory_items_public_id_check", sql`${table.publicId} ~ '^item_[a-z0-9_-]+$'`),
    check("inventory_items_name_en_check", sql`char_length(btrim(${table.nameEn})) BETWEEN 1 AND 120`),
    check(
      "inventory_items_name_ar_check",
      sql`${table.nameAr} IS NULL OR char_length(btrim(${table.nameAr})) BETWEEN 1 AND 120`,
    ),
    check("inventory_items_kind_check", sql`${table.kind} IN ('purchased', 'prepared')`),
    check("inventory_items_status_check", sql`${table.status} IN ('active', 'archived')`),
    check("inventory_items_version_check", sql`${table.version} >= 1`),
  ],
);

export const inventoryItemConversions = qos.table(
  "inventory_item_conversions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    publicId: text("public_id").notNull(),
    itemId: uuid("item_id").notNull(),
    fromUnitId: uuid("from_unit_id").notNull(),
    toUnitId: uuid("to_unit_id").notNull(),
    /** 1 from unit = factor_micros / 1_000_000 to units, for this item only. */
    factorMicros: bigint("factor_micros", { mode: "bigint" }).notNull(),
    justification: text("justification"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    revision: integer("revision").notNull(),
    provenance: dataProvenanceEnum("provenance").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBySubject: text("created_by_subject"),
  },
  (table) => [
    unique("inventory_item_conversions_tenant_public_id_unique").on(table.tenantId, table.publicId),
    unique("inventory_item_conversions_revision_unique").on(
      table.tenantId,
      table.itemId,
      table.fromUnitId,
      table.toUnitId,
      table.revision,
    ),
    foreignKey({
      name: "inventory_item_conversions_item_fk",
      columns: [table.tenantId, table.itemId],
      foreignColumns: [inventoryItems.tenantId, inventoryItems.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "inventory_item_conversions_from_unit_fk",
      columns: [table.tenantId, table.fromUnitId],
      foreignColumns: [inventoryUnits.tenantId, inventoryUnits.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "inventory_item_conversions_to_unit_fk",
      columns: [table.tenantId, table.toUnitId],
      foreignColumns: [inventoryUnits.tenantId, inventoryUnits.id],
    }).onDelete("restrict"),
    uniqueIndex("inventory_item_conversions_current_unique")
      .on(table.tenantId, table.itemId, table.fromUnitId, table.toUnitId)
      .where(sql`effective_to IS NULL`),
    index("inventory_item_conversions_tenant_item_idx").on(table.tenantId, table.itemId),
    check("inventory_item_conversions_public_id_check", sql`${table.publicId} ~ '^conv_[a-z0-9_-]+$'`),
    check("inventory_item_conversions_units_check", sql`${table.fromUnitId} <> ${table.toUnitId}`),
    check("inventory_item_conversions_factor_check", sql`${table.factorMicros} > 0`),
    check(
      "inventory_item_conversions_justification_check",
      sql`${table.justification} IS NULL OR char_length(${table.justification}) <= 200`,
    ),
    check(
      "inventory_item_conversions_dates_check",
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
    check("inventory_item_conversions_revision_check", sql`${table.revision} >= 1`),
  ],
);

/* QOS-197 dated item reference costs (0062). Append-only version rows like
   conversions: qos_app may only set effective_to. No current row means the
   cost is unknown; a known zero is an explicit amount_micros = 0. Separate
   from the catalogue reference-cost policies and from any stock valuation. */
export const inventoryItemReferenceCosts = qos.table(
  "inventory_item_reference_costs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    publicId: text("public_id").notNull(),
    itemId: uuid("item_id").notNull(),
    /** One of the item's designated units; the amount is per 1 of this unit. */
    unitId: uuid("unit_id").notNull(),
    /** Exact amount in micros of the major currency unit (6 decimal places). */
    amountMicros: bigint("amount_micros", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    taxBasis: text("tax_basis").notNull().$type<"net" | "gross" | "unconfirmed">(),
    source: text("source").notNull().$type<"manual" | "supplier_quote" | "invoice">(),
    sourceReference: text("source_reference"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    revision: integer("revision").notNull(),
    provenance: dataProvenanceEnum("provenance").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBySubject: text("created_by_subject"),
  },
  (table) => [
    unique("inventory_item_reference_costs_tenant_public_id_unique").on(table.tenantId, table.publicId),
    unique("inventory_item_reference_costs_revision_unique").on(table.tenantId, table.itemId, table.revision),
    foreignKey({
      name: "inventory_item_reference_costs_item_fk",
      columns: [table.tenantId, table.itemId],
      foreignColumns: [inventoryItems.tenantId, inventoryItems.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "inventory_item_reference_costs_unit_fk",
      columns: [table.tenantId, table.unitId],
      foreignColumns: [inventoryUnits.tenantId, inventoryUnits.id],
    }).onDelete("restrict"),
    uniqueIndex("inventory_item_reference_costs_current_unique")
      .on(table.tenantId, table.itemId)
      .where(sql`effective_to IS NULL`),
    index("inventory_item_reference_costs_tenant_item_idx").on(table.tenantId, table.itemId),
    check("inventory_item_reference_costs_public_id_check", sql`${table.publicId} ~ '^cost_[a-z0-9_-]+$'`),
    check("inventory_item_reference_costs_amount_check", sql`${table.amountMicros} >= 0`),
    check("inventory_item_reference_costs_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "inventory_item_reference_costs_tax_basis_check",
      sql`${table.taxBasis} IN ('net', 'gross', 'unconfirmed')`,
    ),
    check(
      "inventory_item_reference_costs_source_check",
      sql`${table.source} IN ('manual', 'supplier_quote', 'invoice')`,
    ),
    check(
      "inventory_item_reference_costs_source_reference_check",
      sql`${table.sourceReference} IS NULL OR char_length(${table.sourceReference}) <= 200`,
    ),
    check(
      "inventory_item_reference_costs_dates_check",
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
    check("inventory_item_reference_costs_revision_check", sql`${table.revision} >= 1`),
  ],
);

/* QOS-196 branch warehouses (0061). A warehouse belongs to exactly one
   location of its tenant (composite FK); the location never changes after
   create and at most one active warehouse exists per location. */
export const inventoryWarehouses = qos.table(
  "inventory_warehouses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    publicId: text("public_id").notNull(),
    locationId: uuid("location_id").notNull(),
    code: text("code").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar"),
    notes: text("notes"),
    status: text("status").notNull().default("active").$type<"active" | "archived">(),
    version: integer("version").notNull().default(1),
    provenance: dataProvenanceEnum("provenance").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBySubject: text("created_by_subject"),
    updatedBySubject: text("updated_by_subject"),
  },
  (table) => [
    unique("inventory_warehouses_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("inventory_warehouses_tenant_public_id_unique").on(table.tenantId, table.publicId),
    foreignKey({
      name: "inventory_warehouses_location_fk",
      columns: [table.tenantId, table.locationId],
      foreignColumns: [locations.tenantId, locations.id],
    }).onDelete("restrict"),
    uniqueIndex("inventory_warehouses_tenant_code_unique").on(table.tenantId, sql`lower(${table.code})`),
    uniqueIndex("inventory_warehouses_active_location_unique")
      .on(table.tenantId, table.locationId)
      .where(sql`status = 'active'`),
    index("inventory_warehouses_tenant_location_idx").on(table.tenantId, table.locationId),
    check("inventory_warehouses_public_id_check", sql`${table.publicId} ~ '^wh_[a-z0-9_-]+$'`),
    check("inventory_warehouses_code_check", sql`${table.code} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$'`),
    check("inventory_warehouses_name_en_check", sql`char_length(btrim(${table.nameEn})) BETWEEN 1 AND 120`),
    check(
      "inventory_warehouses_name_ar_check",
      sql`${table.nameAr} IS NULL OR char_length(btrim(${table.nameAr})) BETWEEN 1 AND 120`,
    ),
    check("inventory_warehouses_notes_check", sql`${table.notes} IS NULL OR char_length(${table.notes}) <= 400`),
    check("inventory_warehouses_status_check", sql`${table.status} IN ('active', 'archived')`),
    check("inventory_warehouses_version_check", sql`${table.version} >= 1`),
  ],
);

/* QOS-198 versioned recipes, preparation steps and sellable links (0063).
   A family has numbered versions; approved and discarded versions are
   read-only (service), qos_app cannot change a version's identity columns or
   a line's version, and the approval snapshot is insert-only. Sellable links
   are append-only like reference costs: qos_app may only set effective_to. */
export const recipes = qos.table(
  "recipes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    publicId: text("public_id").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar"),
    kind: text("kind").notNull().$type<"sellable" | "prepared">(),
    /** The prepared inventory item a prepared family produces; null for sellable families. */
    outputItemId: uuid("output_item_id"),
    notes: text("notes"),
    status: text("status").notNull().default("active").$type<"active" | "archived">(),
    version: integer("version").notNull().default(1),
    provenance: dataProvenanceEnum("provenance").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBySubject: text("created_by_subject"),
    updatedBySubject: text("updated_by_subject"),
  },
  (table) => [
    unique("recipes_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("recipes_tenant_public_id_unique").on(table.tenantId, table.publicId),
    foreignKey({
      name: "recipes_output_item_fk",
      columns: [table.tenantId, table.outputItemId],
      foreignColumns: [inventoryItems.tenantId, inventoryItems.id],
    }).onDelete("restrict"),
    uniqueIndex("recipes_active_output_item_unique")
      .on(table.tenantId, table.outputItemId)
      .where(sql`status = 'active' AND output_item_id IS NOT NULL`),
    index("recipes_tenant_id_idx").on(table.tenantId),
    check("recipes_public_id_check", sql`${table.publicId} ~ '^rec_[a-z0-9_-]+$'`),
    check("recipes_name_en_check", sql`char_length(btrim(${table.nameEn})) BETWEEN 1 AND 120`),
    check("recipes_name_ar_check", sql`${table.nameAr} IS NULL OR char_length(btrim(${table.nameAr})) BETWEEN 1 AND 120`),
    check("recipes_kind_check", sql`${table.kind} IN ('sellable', 'prepared')`),
    check("recipes_output_item_check", sql`(${table.kind} = 'prepared') = (${table.outputItemId} IS NOT NULL)`),
    check("recipes_notes_check", sql`${table.notes} IS NULL OR char_length(${table.notes}) <= 1000`),
    check("recipes_status_check", sql`${table.status} IN ('active', 'archived')`),
    check("recipes_version_check", sql`${table.version} >= 1`),
  ],
);

export const recipeVersions = qos.table(
  "recipe_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    publicId: text("public_id").notNull(),
    recipeId: uuid("recipe_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    status: text("status").notNull().default("draft").$type<"draft" | "approved" | "discarded">(),
    /** Half-open business-date range [effective_from, effective_to); both null until approved. */
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    /** The whole stated yield in micros of the yield unit; line quantities describe this yield. */
    yieldQuantityMicros: bigint("yield_quantity_micros", { mode: "bigint" }),
    yieldUnitId: uuid("yield_unit_id"),
    notes: text("notes"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBySubject: text("approved_by_subject"),
    version: integer("version").notNull().default(1),
    provenance: dataProvenanceEnum("provenance").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBySubject: text("created_by_subject"),
    updatedBySubject: text("updated_by_subject"),
  },
  (table) => [
    unique("recipe_versions_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("recipe_versions_tenant_public_id_unique").on(table.tenantId, table.publicId),
    unique("recipe_versions_number_unique").on(table.tenantId, table.recipeId, table.versionNumber),
    foreignKey({
      name: "recipe_versions_recipe_fk",
      columns: [table.tenantId, table.recipeId],
      foreignColumns: [recipes.tenantId, recipes.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "recipe_versions_yield_unit_fk",
      columns: [table.tenantId, table.yieldUnitId],
      foreignColumns: [inventoryUnits.tenantId, inventoryUnits.id],
    }).onDelete("restrict"),
    uniqueIndex("recipe_versions_open_draft_unique").on(table.tenantId, table.recipeId).where(sql`status = 'draft'`),
    uniqueIndex("recipe_versions_current_approved_unique")
      .on(table.tenantId, table.recipeId)
      .where(sql`status = 'approved' AND effective_to IS NULL`),
    index("recipe_versions_tenant_recipe_idx").on(table.tenantId, table.recipeId),
    check("recipe_versions_public_id_check", sql`${table.publicId} ~ '^recv_[a-z0-9_-]+$'`),
    check("recipe_versions_version_number_check", sql`${table.versionNumber} >= 1`),
    check("recipe_versions_status_check", sql`${table.status} IN ('draft', 'approved', 'discarded')`),
    check("recipe_versions_yield_check", sql`${table.yieldQuantityMicros} IS NULL OR ${table.yieldQuantityMicros} > 0`),
    check("recipe_versions_notes_check", sql`${table.notes} IS NULL OR char_length(${table.notes}) <= 1000`),
    check(
      "recipe_versions_approved_check",
      sql`${table.status} <> 'approved' OR (${table.effectiveFrom} IS NOT NULL AND ${table.yieldQuantityMicros} IS NOT NULL AND ${table.yieldUnitId} IS NOT NULL AND ${table.approvedAt} IS NOT NULL)`,
    ),
    check(
      "recipe_versions_unapproved_dates_check",
      sql`${table.status} = 'approved' OR (${table.effectiveFrom} IS NULL AND ${table.effectiveTo} IS NULL)`,
    ),
    check("recipe_versions_dates_check", sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`),
    check("recipe_versions_version_check", sql`${table.version} >= 1`),
  ],
);

export const recipeVersionLines = qos.table(
  "recipe_version_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    publicId: text("public_id").notNull(),
    recipeVersionId: uuid("recipe_version_id").notNull(),
    itemId: uuid("item_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    /** Quantity for the whole stated yield, in micros of the line unit. */
    quantityMicros: bigint("quantity_micros", { mode: "bigint" }).notNull(),
    position: integer("position").notNull(),
    labelEn: text("label_en"),
    labelAr: text("label_ar"),
    status: text("status").notNull().default("active").$type<"active" | "removed">(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBySubject: text("created_by_subject"),
    updatedBySubject: text("updated_by_subject"),
  },
  (table) => [
    unique("recipe_version_lines_tenant_public_id_unique").on(table.tenantId, table.publicId),
    // QOS-199: lets a modifier effect reference a line of the same version by composite FK.
    unique("recipe_version_lines_tenant_version_id_unique").on(table.tenantId, table.recipeVersionId, table.id),
    foreignKey({
      name: "recipe_version_lines_version_fk",
      columns: [table.tenantId, table.recipeVersionId],
      foreignColumns: [recipeVersions.tenantId, recipeVersions.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "recipe_version_lines_item_fk",
      columns: [table.tenantId, table.itemId],
      foreignColumns: [inventoryItems.tenantId, inventoryItems.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "recipe_version_lines_unit_fk",
      columns: [table.tenantId, table.unitId],
      foreignColumns: [inventoryUnits.tenantId, inventoryUnits.id],
    }).onDelete("restrict"),
    uniqueIndex("recipe_version_lines_active_item_unique")
      .on(table.tenantId, table.recipeVersionId, table.itemId)
      .where(sql`status = 'active'`),
    index("recipe_version_lines_tenant_version_idx").on(table.tenantId, table.recipeVersionId),
    index("recipe_version_lines_tenant_item_idx").on(table.tenantId, table.itemId),
    check("recipe_version_lines_public_id_check", sql`${table.publicId} ~ '^recl_[a-z0-9_-]+$'`),
    check("recipe_version_lines_quantity_check", sql`${table.quantityMicros} > 0`),
    check("recipe_version_lines_position_check", sql`${table.position} >= 0`),
    check("recipe_version_lines_label_en_check", sql`${table.labelEn} IS NULL OR char_length(${table.labelEn}) <= 120`),
    check("recipe_version_lines_label_ar_check", sql`${table.labelAr} IS NULL OR char_length(${table.labelAr}) <= 120`),
    check("recipe_version_lines_status_check", sql`${table.status} IN ('active', 'removed')`),
  ],
);

export const recipeVersionSteps = qos.table(
  "recipe_version_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    publicId: text("public_id").notNull(),
    recipeVersionId: uuid("recipe_version_id").notNull(),
    position: integer("position").notNull(),
    textEn: text("text_en").notNull(),
    textAr: text("text_ar"),
    status: text("status").notNull().default("active").$type<"active" | "removed">(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBySubject: text("created_by_subject"),
    updatedBySubject: text("updated_by_subject"),
  },
  (table) => [
    unique("recipe_version_steps_tenant_public_id_unique").on(table.tenantId, table.publicId),
    foreignKey({
      name: "recipe_version_steps_version_fk",
      columns: [table.tenantId, table.recipeVersionId],
      foreignColumns: [recipeVersions.tenantId, recipeVersions.id],
    }).onDelete("restrict"),
    index("recipe_version_steps_tenant_version_idx").on(table.tenantId, table.recipeVersionId),
    check("recipe_version_steps_public_id_check", sql`${table.publicId} ~ '^recs_[a-z0-9_-]+$'`),
    check("recipe_version_steps_position_check", sql`${table.position} >= 0`),
    check("recipe_version_steps_text_en_check", sql`char_length(btrim(${table.textEn})) BETWEEN 1 AND 1000`),
    check(
      "recipe_version_steps_text_ar_check",
      sql`${table.textAr} IS NULL OR char_length(btrim(${table.textAr})) BETWEEN 1 AND 1000`,
    ),
    check("recipe_version_steps_status_check", sql`${table.status} IN ('active', 'removed')`),
  ],
);

export const recipeVersionSnapshots = qos.table(
  "recipe_version_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    recipeVersionId: uuid("recipe_version_id").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBySubject: text("created_by_subject"),
  },
  (table) => [
    unique("recipe_version_snapshots_version_unique").on(table.tenantId, table.recipeVersionId),
    foreignKey({
      name: "recipe_version_snapshots_version_fk",
      columns: [table.tenantId, table.recipeVersionId],
      foreignColumns: [recipeVersions.tenantId, recipeVersions.id],
    }).onDelete("restrict"),
  ],
);

export const recipeSellableLinks = qos.table(
  "recipe_sellable_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    publicId: text("public_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    kind: text("kind").notNull().$type<"recipe" | "direct_stock">(),
    recipeId: uuid("recipe_id"),
    itemId: uuid("item_id"),
    /** Direct stock only: what one sale of the variant uses, in micros of unit_id. */
    quantityMicros: bigint("quantity_micros", { mode: "bigint" }),
    unitId: uuid("unit_id"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    revision: integer("revision").notNull(),
    provenance: dataProvenanceEnum("provenance").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBySubject: text("created_by_subject"),
  },
  (table) => [
    unique("recipe_sellable_links_tenant_public_id_unique").on(table.tenantId, table.publicId),
    unique("recipe_sellable_links_revision_unique").on(table.tenantId, table.variantId, table.revision),
    foreignKey({
      name: "recipe_sellable_links_variant_fk",
      columns: [table.tenantId, table.variantId],
      foreignColumns: [catalogueVariants.tenantId, catalogueVariants.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "recipe_sellable_links_recipe_fk",
      columns: [table.tenantId, table.recipeId],
      foreignColumns: [recipes.tenantId, recipes.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "recipe_sellable_links_item_fk",
      columns: [table.tenantId, table.itemId],
      foreignColumns: [inventoryItems.tenantId, inventoryItems.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "recipe_sellable_links_unit_fk",
      columns: [table.tenantId, table.unitId],
      foreignColumns: [inventoryUnits.tenantId, inventoryUnits.id],
    }).onDelete("restrict"),
    uniqueIndex("recipe_sellable_links_current_unique").on(table.tenantId, table.variantId).where(sql`effective_to IS NULL`),
    index("recipe_sellable_links_tenant_recipe_idx").on(table.tenantId, table.recipeId),
    index("recipe_sellable_links_tenant_item_idx").on(table.tenantId, table.itemId),
    check("recipe_sellable_links_public_id_check", sql`${table.publicId} ~ '^link_[a-z0-9_-]+$'`),
    check("recipe_sellable_links_kind_check", sql`${table.kind} IN ('recipe', 'direct_stock')`),
    check(
      "recipe_sellable_links_shape_check",
      sql`(${table.kind} = 'recipe' AND ${table.recipeId} IS NOT NULL AND ${table.itemId} IS NULL AND ${table.quantityMicros} IS NULL AND ${table.unitId} IS NULL) OR (${table.kind} = 'direct_stock' AND ${table.recipeId} IS NULL AND ${table.itemId} IS NOT NULL AND ${table.quantityMicros} IS NOT NULL AND ${table.unitId} IS NOT NULL)`,
    ),
    check("recipe_sellable_links_quantity_check", sql`${table.quantityMicros} IS NULL OR ${table.quantityMicros} > 0`),
    check(
      "recipe_sellable_links_dates_check",
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
    check("recipe_sellable_links_revision_check", sql`${table.revision} >= 1`),
  ],
);

/* QOS-199: what one selected modifier option adds to, removes from or
   replaces in one recipe version. remove and replace target a base line of
   the same version (composite FK); only drafts change (service rule). */
export const recipeVersionModifierEffects = qos.table(
  "recipe_version_modifier_effects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    publicId: text("public_id").notNull(),
    recipeVersionId: uuid("recipe_version_id").notNull(),
    modifierOptionId: uuid("modifier_option_id").notNull(),
    effectType: text("effect_type").notNull().$type<"add" | "remove" | "replace">(),
    targetLineId: uuid("target_line_id"),
    itemId: uuid("item_id"),
    unitId: uuid("unit_id"),
    /** Per selected option per sold unit, in micros of unit_id; null for remove. */
    quantityMicros: bigint("quantity_micros", { mode: "bigint" }),
    notes: text("notes"),
    position: integer("position").notNull(),
    status: text("status").notNull().default("active").$type<"active" | "removed">(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBySubject: text("created_by_subject"),
    updatedBySubject: text("updated_by_subject"),
  },
  (table) => [
    unique("recipe_version_modifier_effects_tenant_public_id_unique").on(table.tenantId, table.publicId),
    foreignKey({
      name: "recipe_version_modifier_effects_version_fk",
      columns: [table.tenantId, table.recipeVersionId],
      foreignColumns: [recipeVersions.tenantId, recipeVersions.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "recipe_version_modifier_effects_option_fk",
      columns: [table.tenantId, table.modifierOptionId],
      foreignColumns: [catalogueModifierOptions.tenantId, catalogueModifierOptions.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "recipe_version_modifier_effects_target_line_fk",
      columns: [table.tenantId, table.recipeVersionId, table.targetLineId],
      foreignColumns: [recipeVersionLines.tenantId, recipeVersionLines.recipeVersionId, recipeVersionLines.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "recipe_version_modifier_effects_item_fk",
      columns: [table.tenantId, table.itemId],
      foreignColumns: [inventoryItems.tenantId, inventoryItems.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "recipe_version_modifier_effects_unit_fk",
      columns: [table.tenantId, table.unitId],
      foreignColumns: [inventoryUnits.tenantId, inventoryUnits.id],
    }).onDelete("restrict"),
    uniqueIndex("recipe_version_modifier_effects_active_target_unique")
      .on(table.tenantId, table.recipeVersionId, table.modifierOptionId, table.targetLineId)
      .where(sql`status = 'active' AND target_line_id IS NOT NULL`),
    uniqueIndex("recipe_version_modifier_effects_active_add_unique")
      .on(table.tenantId, table.recipeVersionId, table.modifierOptionId, table.itemId)
      .where(sql`status = 'active' AND effect_type = 'add'`),
    index("recipe_version_modifier_effects_tenant_version_idx").on(table.tenantId, table.recipeVersionId),
    index("recipe_version_modifier_effects_tenant_option_idx").on(table.tenantId, table.modifierOptionId),
    index("recipe_version_modifier_effects_tenant_item_idx").on(table.tenantId, table.itemId),
    check("recipe_version_modifier_effects_public_id_check", sql`${table.publicId} ~ '^eff_[a-z0-9_-]+$'`),
    check("recipe_version_modifier_effects_type_check", sql`${table.effectType} IN ('add', 'remove', 'replace')`),
    check(
      "recipe_version_modifier_effects_shape_check",
      sql`(${table.effectType} = 'add' AND ${table.targetLineId} IS NULL AND ${table.itemId} IS NOT NULL AND ${table.unitId} IS NOT NULL AND ${table.quantityMicros} IS NOT NULL) OR (${table.effectType} = 'remove' AND ${table.targetLineId} IS NOT NULL AND ${table.itemId} IS NULL AND ${table.unitId} IS NULL AND ${table.quantityMicros} IS NULL) OR (${table.effectType} = 'replace' AND ${table.targetLineId} IS NOT NULL AND ${table.itemId} IS NOT NULL AND ${table.unitId} IS NOT NULL AND ${table.quantityMicros} IS NOT NULL)`,
    ),
    check("recipe_version_modifier_effects_quantity_check", sql`${table.quantityMicros} IS NULL OR ${table.quantityMicros} > 0`),
    check("recipe_version_modifier_effects_notes_check", sql`${table.notes} IS NULL OR char_length(${table.notes}) <= 200`),
    check("recipe_version_modifier_effects_position_check", sql`${table.position} >= 0`),
    check("recipe_version_modifier_effects_status_check", sql`${table.status} IN ('active', 'removed')`),
  ],
);

export type InventoryUnitRecord = typeof inventoryUnits.$inferSelect;
export type InventoryItemRecord = typeof inventoryItems.$inferSelect;
export type InventoryItemConversionRecord = typeof inventoryItemConversions.$inferSelect;
export type InventorySupplierRecord = typeof inventorySuppliers.$inferSelect;
export type InventoryWarehouseRecord = typeof inventoryWarehouses.$inferSelect;
export type InventoryCategoryRecord = typeof inventoryCategories.$inferSelect;
export type InventoryItemReferenceCostRecord = typeof inventoryItemReferenceCosts.$inferSelect;
export type RecipeRecord = typeof recipes.$inferSelect;
export type RecipeVersionRecord = typeof recipeVersions.$inferSelect;
export type RecipeVersionLineRecord = typeof recipeVersionLines.$inferSelect;
export type RecipeVersionStepRecord = typeof recipeVersionSteps.$inferSelect;
export type RecipeVersionSnapshotRecord = typeof recipeVersionSnapshots.$inferSelect;
export type RecipeSellableLinkRecord = typeof recipeSellableLinks.$inferSelect;
export type RecipeVersionModifierEffectRecord = typeof recipeVersionModifierEffects.$inferSelect;

export const schema = {
  tenants,
  organizations,
  brands,
  locations,
  locationExternalMenuSources,
  catalogueProducts,
  catalogueProductTranslations,
  catalogueVariants,
  catalogueVariantPrices,
  catalogueVariantLocationPriceOverrides,
  catalogueVariantLocationPriceResetAudits,
  catalogueModifierGroups,
  catalogueModifierGroupTranslations,
  catalogueModifierOptions,
  catalogueModifierOptionTranslations,
  catalogueProductModifierGroups,
  catalogueCategories,
  catalogueCategoryTranslations,
  catalogueProductCategories,
  catalogueMenus,
  catalogueMenuTranslations,
  catalogueMenuLocations,
  catalogueMenuSections,
  catalogueMenuSectionTranslations,
  catalogueMenuSectionProducts,
  catalogueMenuLiveRevisions,
  catalogueMenuPublishOperations,
  catalogueMenuPublicLinks,
  catalogueImportSourceLinks,
  catalogueImportOperations,
  workbookImportPlans,
  workbookImportPlanRows,
  workbookImportApplies,
  workbookSourceLinks,
  catalogueMediaAssets,
  catalogueMediaUploadGrants,
  catalogueMediaDerivatives,
  storefronts,
  storefrontReleases,
  storefrontDomains,
  storefrontDeployments,
  storefrontLocations,
  storefrontPublishedCollections,
  customerAuthUsers,
  customerAuthSessions,
  customerAuthAccounts,
  customerAuthVerifications,
  staffAuthUsers,
  staffAuthSessions,
  staffAuthAccounts,
  staffAuthVerifications,
  storefrontCustomerAssociations,
  storefrontAnonymousSessions,
  storefrontAnonymousBaskets,
  storefrontAnonymousBasketLines,
  storefrontAnonymousBasketMutations,
  storefrontCustomerBaskets,
  storefrontCustomerBasketLines,
  storefrontCustomerBasketMutations,
  storefrontBasketMergeOperations,
  storefrontCheckoutQuotes,
  storefrontCheckoutQuoteOperations,
  storefrontCheckoutPaymentAttempts,
  storefrontCheckoutPaymentOperations,
  storefrontCheckoutProviderEvents,
  staffIdentities,
  staffMemberships,
  staffInvitations,
  staffInvitationLocations,
  staffAccessRequests,
  staffAccessRequestLocations,
  businessProvisioningOperations,
  tenantAuditEvents,
  staffLocationScopes,
  agentProviderConnections,
  agentProviderCredentials,
  tenantAgentBindings,
  agentRuns,
  agentRunMenuManagerSuggestionAcceptances,
  agentRunInputs,
  aiSpendReservations,
  aiSpendTenantCounters,
  aiSpendPlatformCounters,
  aiJobs,
  aiJobAttempts,
};

export type TenantRecord = typeof tenants.$inferSelect;
export type OrganizationRecord = typeof organizations.$inferSelect;
export type BrandRecord = typeof brands.$inferSelect;
export type LocationRecord = typeof locations.$inferSelect;

export const tenantContextSetting = "qos.current_tenant_id";
export const operatorProvisioningSetting = "qos.operator_provisioning";
export const agentCredentialAccessSetting = "qos.agent_credential_access";
export const agentPlatformAdminSetting = "qos.agent_platform_admin";

export function currentTenantIdSql() {
  return sql`current_setting(${tenantContextSetting}, true)::uuid`;
}
