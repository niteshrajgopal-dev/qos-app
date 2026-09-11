import { relations, sql } from "drizzle-orm";
import {
  boolean,
  char,
  foreignKey,
  index,
  integer,
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
  catalogueModifierGroups,
  catalogueModifierGroupTranslations,
  catalogueModifierOptions,
  catalogueModifierOptionTranslations,
  catalogueProductModifierGroups,
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
