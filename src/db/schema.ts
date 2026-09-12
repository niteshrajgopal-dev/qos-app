import { relations, sql } from "drizzle-orm";
import {
  boolean,
  char,
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { pgSchema } from "drizzle-orm/pg-core";

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
  ["draft", "approved"],
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("staff_invitations_tenant_id_idx").on(table.tenantId),
    index("staff_invitations_email_idx").on(table.email),
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
    priceMinor: integer("price_minor").notNull().default(0),
    currency: char("currency", { length: 3 }).notNull().default("AED"),
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

export const catalogueProductModifierGroups = qos.table(
  "catalogue_product_modifier_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    productId: uuid("product_id").notNull(),
    modifierGroupId: uuid("modifier_group_id").notNull(),
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
      columns: [table.tenantId, table.modifierGroupId],
      foreignColumns: [
        catalogueModifierGroups.tenantId,
        catalogueModifierGroups.id,
      ],
    }).onDelete("restrict"),
    unique("catalogue_product_modifier_groups_unique").on(
      table.tenantId,
      table.productId,
      table.modifierGroupId,
    ),
    index("catalogue_product_modifier_groups_tenant_id_idx").on(table.tenantId),
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

export type StorefrontDraftConfig = {
  theme?: Record<string, unknown>;
  navigation?: Array<{ id: string; labelKey: string; href: string }>;
  contentBlocks?: Array<{
    id: string;
    type: string;
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
  catalogueMenus,
  catalogueMenuTranslations,
  catalogueMenuLocations,
  catalogueMenuSections,
  catalogueMenuSectionTranslations,
  catalogueMenuSectionProducts,
  catalogueMenuLiveRevisions,
  catalogueMenuPublishOperations,
  catalogueMenuPublicLinks,
  catalogueMediaAssets,
  catalogueMediaUploadGrants,
  catalogueMediaDerivatives,
  storefronts,
  storefrontReleases,
  storefrontDomains,
  storefrontLocations,
  storefrontPublishedCollections,
  customerAuthUsers,
  customerAuthSessions,
  customerAuthAccounts,
  customerAuthVerifications,
  storefrontCustomerAssociations,
  storefrontAnonymousSessions,
  storefrontAnonymousBaskets,
  storefrontAnonymousBasketLines,
  storefrontAnonymousBasketMutations,
  staffIdentities,
  staffMemberships,
  staffInvitations,
  staffAccessRequests,
  staffAccessRequestLocations,
  businessProvisioningOperations,
  staffLocationScopes,
};

export type TenantRecord = typeof tenants.$inferSelect;
export type OrganizationRecord = typeof organizations.$inferSelect;
export type BrandRecord = typeof brands.$inferSelect;
export type LocationRecord = typeof locations.$inferSelect;

export const tenantContextSetting = "qos.current_tenant_id";

export function currentTenantIdSql() {
  return sql`current_setting(${tenantContextSetting}, true)::uuid`;
}
