import { and, eq, sql } from "drizzle-orm";

import { createDbClient } from "@/db/client";
import {
  brands,
  catalogueMenus,
  catalogueProducts,
  customerAuthUsers,
  locations,
  organizations,
  staffAuthUsers,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
  storefrontDomains,
  storefronts,
  tenants,
} from "@/db/schema";
import { approveProductTranslation } from "@/lib/catalogue/translation-approval";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { publishDraftMenuToLocations } from "@/lib/catalogue/menu-publish";
import { createDraftProduct } from "@/lib/catalogue/products";
import { getCustomerAuth } from "@/lib/customer/auth-server";
import { defaultStorefrontDraftConfig } from "@/lib/storefront/default-theme";
import { QUOTES_TENANT_PUBLIC_ID } from "@/lib/seed/constants";
import { quotesLocationFixtures } from "@/lib/seed/fixtures/quotes-locations";
import { getStaffAuth } from "@/lib/staff/auth-server";
import {
  assignPublishedCollection,
  createStorefront,
  publishStorefrontRelease,
  registerStorefrontDomain,
} from "@/lib/storefront/storefronts";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import {
  setOperatorProvisioningContext,
  setTenantContext,
  withTenantContext,
} from "@/lib/tenant/context";

const API_BASE =
  "https://ca-qos-dev-api.gentleplant-cc8574e8.uaenorth.azurecontainerapps.io";
const QUOTES_HOST = "quotes.dev.qosapp.com";
const STOREFRONT_PUBLIC_ID = "stf_quotes_e748d7fc";

const STAFF_EMAIL = "staff.demo@qosapp.com";
const STAFF_PASSWORD = "DemoStaff123!";
const STAFF_NAME = "Quotes Demo Admin";

const CUSTOMER_EMAIL = "checkout-demo@qosapp.com";
const CUSTOMER_PASSWORD = "Password123!";
const CUSTOMER_NAME = "Checkout Demo";

const PRODUCT_INTERNAL_NAME = "quotes-demo-latte";
const MENU_INTERNAL_NAME = "quotes-demo-menu";

function ensureAuthEnv() {
  process.env.BETTER_AUTH_SECRET =
    process.env.BETTER_AUTH_SECRET ||
    process.env.STAFF_BETTER_AUTH_SECRET ||
    "local-dev-better-auth-secret-with-length";
  process.env.BETTER_AUTH_URL =
    process.env.BETTER_AUTH_URL || `https://${QUOTES_HOST}`;
  process.env.STAFF_BETTER_AUTH_URL =
    process.env.STAFF_BETTER_AUTH_URL || API_BASE;
}

async function resolveQuotesTenantId(
  db: Awaited<ReturnType<typeof createDbClient>>["db"],
) {
  const rows = await db.execute<{ id: string | null }>(
    sql`select qos.resolve_tenant_id_by_public_id(${QUOTES_TENANT_PUBLIC_ID}) as id`,
  );
  const row = Array.isArray(rows) ? rows[0] : undefined;
  return row?.id ?? null;
}

async function ensureQuotesTenant(
  db: Awaited<ReturnType<typeof createDbClient>>["db"],
) {
  const existingId = await resolveQuotesTenantId(db);
  const fixture = quotesTenantFixture();

  if (existingId) {
    return withTenantContext(db, existingId, async (tx) => {
      const [tenant] = await tx
        .select()
        .from(tenants)
        .where(eq(tenants.id, existingId))
        .limit(1);
      const [brand] = await tx
        .select()
        .from(brands)
        .where(
          and(eq(brands.tenantId, existingId), eq(brands.publicId, "brd_quotes")),
        )
        .limit(1);
      if (!tenant || !brand) {
        throw new Error("Quotes tenant exists but brand/tenant rows are hidden.");
      }
      return { tenant, brand };
    });
  }

  return db.transaction(async (tx) => {
    await setOperatorProvisioningContext(tx);

    const [tenant] = await tx
      .insert(tenants)
      .values({
        publicId: fixture.tenant.publicId,
        name: fixture.tenant.name,
        businessProfile: fixture.tenant.businessProfile,
        baseCurrency: fixture.tenant.baseCurrency,
        defaultLocale: fixture.tenant.defaultLocale,
        defaultTimezone: fixture.tenant.defaultTimezone,
        supportedLocales: fixture.tenant.supportedLocales ?? ["en", "ar"],
        provisionedByOperatorId: "seed.demo-accounts",
      })
      .returning();

    await setTenantContext(tx, tenant.id);

    await tx.insert(organizations).values({
      tenantId: tenant.id,
      publicId: fixture.organization.publicId,
      name: fixture.organization.name,
      isDefault: true,
    });

    const [organization] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.tenantId, tenant.id))
      .limit(1);

    const [brand] = await tx
      .insert(brands)
      .values({
        tenantId: tenant.id,
        organizationId: organization.id,
        publicId: fixture.brand.publicId,
        name: fixture.brand.name,
      })
      .returning();

    return { tenant, brand };
  });
}

async function ensureQuotesLocations(
  db: Awaited<ReturnType<typeof createDbClient>>["db"],
  tenantId: string,
  brandId: string,
) {
  return withTenantContext(db, tenantId, async (tx) => {
    const created = [];

    for (const fixture of quotesLocationFixtures) {
      const [existing] = await tx
        .select()
        .from(locations)
        .where(
          and(
            eq(locations.tenantId, tenantId),
            eq(locations.publicId, fixture.publicId),
          ),
        )
        .limit(1);

      if (existing) {
        created.push(existing);
        continue;
      }

      const [location] = await tx
        .insert(locations)
        .values({
          tenantId,
          brandId,
          publicId: fixture.publicId,
          name: fixture.name,
          slug: fixture.slug,
          timezone: fixture.timezone,
        })
        .returning();

      created.push(location);
    }

    return created;
  });
}

async function ensureQuotesStorefront(
  db: Awaited<ReturnType<typeof createDbClient>>["db"],
  tenantId: string,
  locationPublicIds: string[],
) {
  return withTenantContext(db, tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(storefronts)
      .where(
        and(
          eq(storefronts.tenantId, tenantId),
          eq(storefronts.publicId, STOREFRONT_PUBLIC_ID),
        ),
      )
      .limit(1);

    return existing;
  }).then(async (existing) => {
    if (existing) {
      return existing;
    }

    const created = await createStorefront(db, tenantId, {
      brandPublicId: "brd_quotes",
      internalName: "Quotes Website",
      slug: "quotes",
      defaultLocale: "en",
      supportedLocales: ["en", "ar"],
      locationPublicIds,
      draftConfig: defaultStorefrontDraftConfig("hospitality"),
    });

    await withTenantContext(db, tenantId, async (tx) => {
      await tx
        .update(storefronts)
        .set({ publicId: STOREFRONT_PUBLIC_ID })
        .where(eq(storefronts.id, created.id));
    });

    return { ...created, publicId: STOREFRONT_PUBLIC_ID };
  });
}

async function ensureQuotesDomain(
  db: Awaited<ReturnType<typeof createDbClient>>["db"],
  tenantId: string,
) {
  const existing = await withTenantContext(db, tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(storefrontDomains)
      .where(
        and(
          eq(storefrontDomains.tenantId, tenantId),
          eq(storefrontDomains.hostname, QUOTES_HOST),
        ),
      )
      .limit(1);
    return row ?? null;
  });

  if (existing) {
    if (
      existing.verificationStatus !== "verified" ||
      existing.lifecycleStatus !== "active"
    ) {
      await withTenantContext(db, tenantId, async (tx) => {
        await tx
          .update(storefrontDomains)
          .set({
            verificationStatus: "verified",
            lifecycleStatus: "active",
            isPrimary: true,
          })
          .where(eq(storefrontDomains.id, existing.id));
      });
    }
    return;
  }

  await registerStorefrontDomain(db, tenantId, STOREFRONT_PUBLIC_ID, {
    hostname: QUOTES_HOST,
    domainType: "platform_subdomain",
    verificationStatus: "verified",
    lifecycleStatus: "active",
    isPrimary: true,
  });
}

async function ensureVerifiedStaffUser(
  db: Awaited<ReturnType<typeof createDbClient>>["db"],
) {
  const auth = getStaffAuth();

  const [existing] = await db
    .select()
    .from(staffAuthUsers)
    .where(eq(staffAuthUsers.email, STAFF_EMAIL))
    .limit(1);

  if (!existing) {
    await auth.api.signUpEmail({
      body: {
        email: STAFF_EMAIL,
        password: STAFF_PASSWORD,
        name: STAFF_NAME,
      },
    });
  }

  await db
    .update(staffAuthUsers)
    .set({ emailVerified: true, name: STAFF_NAME })
    .where(eq(staffAuthUsers.email, STAFF_EMAIL));

  const [user] = await db
    .select()
    .from(staffAuthUsers)
    .where(eq(staffAuthUsers.email, STAFF_EMAIL))
    .limit(1);

  if (!user) {
    throw new Error("Failed to create verified staff auth user.");
  }

  return user;
}

async function ensureStaffAdminMembership(
  db: Awaited<ReturnType<typeof createDbClient>>["db"],
  tenantId: string,
  locationIds: string[],
  staffUserId: string,
) {
  return withTenantContext(db, tenantId, async (tx) => {
    const [existingIdentity] = await tx
      .select()
      .from(staffIdentities)
      .where(eq(staffIdentities.providerSubject, staffUserId))
      .limit(1);

    let identity = existingIdentity;

    if (!identity) {
      try {
        const [created] = await tx
          .insert(staffIdentities)
          .values({
            providerSubject: staffUserId,
            email: STAFF_EMAIL,
          })
          .returning();
        identity = created;
      } catch {
        await tx.execute(sql`
          insert into qos.staff_identities (provider_subject, email)
          values (${staffUserId}, ${STAFF_EMAIL})
          on conflict (provider_subject) do update set email = excluded.email
        `);
        const [created] = await tx
          .select()
          .from(staffIdentities)
          .where(eq(staffIdentities.providerSubject, staffUserId))
          .limit(1);
        identity = created;
      }
    }

    if (!identity) {
      throw new Error(
        "Could not create staff identity under RLS. First-admin insert is blocked.",
      );
    }

    const [existingMembership] = await tx
      .select()
      .from(staffMemberships)
      .where(
        and(
          eq(staffMemberships.tenantId, tenantId),
          eq(staffMemberships.staffIdentityId, identity.id),
        ),
      )
      .limit(1);

    const membership =
      existingMembership ??
      (
        await tx
          .insert(staffMemberships)
          .values({
            tenantId,
            staffIdentityId: identity.id,
            role: "administrator",
          })
          .returning()
      )[0];

    for (const locationId of locationIds) {
      await tx
        .insert(staffLocationScopes)
        .values({
          tenantId,
          staffMembershipId: membership.id,
          locationId,
        })
        .onConflictDoNothing();
    }

    return {
      membershipId: membership.id,
      role: "administrator" as const,
      staffIdentityId: identity.id,
      subject: staffUserId,
    };
  });
}

async function ensureVerifiedCustomer(
  db: Awaited<ReturnType<typeof createDbClient>>["db"],
) {
  const auth = getCustomerAuth();

  const [existing] = await db
    .select()
    .from(customerAuthUsers)
    .where(eq(customerAuthUsers.email, CUSTOMER_EMAIL))
    .limit(1);

  if (!existing) {
    await auth.api.signUpEmail({
      body: {
        email: CUSTOMER_EMAIL,
        password: CUSTOMER_PASSWORD,
        name: CUSTOMER_NAME,
      },
    });
  }

  await db
    .update(customerAuthUsers)
    .set({ emailVerified: true, name: CUSTOMER_NAME })
    .where(eq(customerAuthUsers.email, CUSTOMER_EMAIL));
}

async function ensurePublishedDemoMenu(
  db: Awaited<ReturnType<typeof createDbClient>>["db"],
  tenantId: string,
  admin: {
    membershipId: string;
    role: "administrator";
    staffIdentityId: string;
    subject: string;
  },
  seededLocations: Array<{ id: string; publicId: string }>,
) {
  const existingProduct = await withTenantContext(db, tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(catalogueProducts)
      .where(
        and(
          eq(catalogueProducts.tenantId, tenantId),
          eq(catalogueProducts.internalName, PRODUCT_INTERNAL_NAME),
        ),
      )
      .limit(1);
    return row ?? null;
  });

  const existingMenu = await withTenantContext(db, tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(catalogueMenus)
      .where(
        and(
          eq(catalogueMenus.tenantId, tenantId),
          eq(catalogueMenus.internalName, MENU_INTERNAL_NAME),
        ),
      )
      .limit(1);
    return row ?? null;
  });

  if (existingProduct && existingMenu) {
    return {
      productPublicId: existingProduct.publicId,
      menuPublicId: existingMenu.publicId,
    };
  }

  const createdProduct = existingProduct
    ? null
    : await createDraftProduct(db, tenantId, admin, {
        internalName: PRODUCT_INTERNAL_NAME,
        translations: {
          en: {
            displayName: "Demo Latte",
            description: "Sandbox checkout item for the Phase 1 demo",
          },
          ar: {
            displayName: "لاتيه تجريبي",
            description: "عنصر دفع تجريبي",
          },
        },
        defaultVariant: { amountMinor: 1800, currency: "AED" },
      });

  const product = existingProduct ?? createdProduct;

  if (!product) {
    throw new Error("Unable to seed the demo product.");
  }

  if (createdProduct) {
    for (const locale of ["en", "ar"] as const) {
      await approveProductTranslation(
        db,
        tenantId,
        admin.subject,
        createdProduct.publicId,
        locale,
        {
          expectedTranslationVersion:
            createdProduct.translations[locale].translationVersion,
        },
      );
    }
  }

  const menu =
    existingMenu ??
    (await createDraftMenu(db, tenantId, admin, {
      internalName: MENU_INTERNAL_NAME,
      locationIds: seededLocations.map((location) => location.id),
      translations: {
        en: { displayName: "Demo Menu" },
        ar: { displayName: "قائمة تجريبية" },
      },
      sections: [
        {
          internalName: "drinks",
          sortOrder: 0,
          translations: {
            en: { displayName: "Drinks" },
            ar: { displayName: "مشروبات" },
          },
          products: [{ productPublicId: product.publicId, sortOrder: 0 }],
        },
      ],
    }));

  await publishDraftMenuToLocations(db, tenantId, admin.subject, menu.publicId, {
    locationIds: seededLocations.map((location) => location.id),
  });

  for (const location of seededLocations) {
    await assignPublishedCollection(
      db,
      tenantId,
      STOREFRONT_PUBLIC_ID,
      location.publicId,
      menu.publicId,
    );
  }

  await publishStorefrontRelease(
    db,
    tenantId,
    STOREFRONT_PUBLIC_ID,
    admin.subject,
  );

  return {
    productPublicId: product.publicId,
    menuPublicId: menu.publicId,
  };
}

async function main() {
  ensureAuthEnv();

  const { db, sql: sqlClient } = createDbClient();

  const role = await sqlClient`
    select current_user as user_name, rolbypassrls
    from pg_roles
    where rolname = current_user
  `;
  console.log("Connected as", role[0]);

  const { tenant, brand } = await ensureQuotesTenant(db);
  const seededLocations = await ensureQuotesLocations(db, tenant.id, brand.id);
  await ensureQuotesStorefront(
    db,
    tenant.id,
    seededLocations.map((location) => location.publicId),
  );
  await ensureQuotesDomain(db, tenant.id);

  const staffUser = await ensureVerifiedStaffUser(db);
  const admin = await ensureStaffAdminMembership(
    db,
    tenant.id,
    seededLocations.map((location) => location.id),
    staffUser.id,
  );

  const published = await ensurePublishedDemoMenu(
    db,
    tenant.id,
    admin,
    seededLocations,
  );

  await ensureVerifiedCustomer(db);

  const hbz = seededLocations.find((location) => location.publicId === "loc_quotes_hbz");

  console.log(
    JSON.stringify(
      {
        staff: {
          url: `${API_BASE}/staff/sign-in`,
          email: STAFF_EMAIL,
          password: STAFF_PASSWORD,
          newProductUrl: `${API_BASE}/tenants/${tenant.id}/catalogue/products/new`,
          menusUrl: `${API_BASE}/tenants/${tenant.id}/catalogue/menus`,
          menuEditUrl: `${API_BASE}/tenants/${tenant.id}/catalogue/menus/${published.menuPublicId}/edit`,
        },
        customer: {
          url: `https://${QUOTES_HOST}`,
          email: CUSTOMER_EMAIL,
          password: CUSTOMER_PASSWORD,
          branch: "HBZ Stadium",
        },
        stripe: {
          successCard: "4242424242424242",
          expiry: "12/34",
          cvc: "123",
        },
        ids: {
          tenantId: tenant.id,
          tenantPublicId: tenant.publicId,
          storefrontPublicId: STOREFRONT_PUBLIC_ID,
          locationPublicId: hbz?.publicId ?? seededLocations[0]?.publicId,
          productPublicId: published.productPublicId,
          menuPublicId: published.menuPublicId,
        },
      },
      null,
      2,
    ),
  );

  await sqlClient.end({ timeout: 5 });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
