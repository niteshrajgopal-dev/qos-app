import { eq } from "drizzle-orm";

import { createDbClient } from "@/db/client";
import {
  brands,
  customerAuthUsers,
  locations,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
  storefrontLocations,
  storefronts,
  tenants,
} from "@/db/schema";
import { approveProductTranslation } from "@/lib/catalogue/translation-approval";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { publishDraftMenuToLocations } from "@/lib/catalogue/menu-publish";
import { createDraftProduct } from "@/lib/catalogue/products";
import { getCustomerAuth } from "@/lib/customer/auth-server";
import {
  assignPublishedCollection,
  publishStorefrontRelease,
} from "@/lib/storefront/storefronts";

const DEFAULT_STOREFRONT_PUBLIC_ID = "stf_quotes_e748d7fc";
const DEFAULT_LOCATION_PUBLIC_ID = "loc_hbz-stadium_a02d8b1b";
const DEMO_CUSTOMER_EMAIL = "checkout-demo@qosapp.com";
const DEMO_CUSTOMER_PASSWORD = "Password123!";
const DEMO_CUSTOMER_NAME = "Checkout Demo";

async function ensureStaffAdmin(
  db: Awaited<ReturnType<typeof createDbClient>>["db"],
  tenantId: string,
  locationId: string,
) {
  const subject = "seed.checkout-demo@qosapp.com";

  const [existingIdentity] = await db
    .select()
    .from(staffIdentities)
    .where(eq(staffIdentities.providerSubject, subject))
    .limit(1);

  const identity =
    existingIdentity ??
    (
      await db
        .insert(staffIdentities)
        .values({ providerSubject: subject, email: subject })
        .returning()
    )[0];

  const [existingMembership] = await db
    .select()
    .from(staffMemberships)
    .where(eq(staffMemberships.staffIdentityId, identity.id))
    .limit(1);

  const membership =
    existingMembership ??
    (
      await db
        .insert(staffMemberships)
        .values({
          tenantId,
          staffIdentityId: identity.id,
          role: "administrator",
        })
        .returning()
    )[0];

  await db
    .insert(staffLocationScopes)
    .values({
      tenantId,
      staffMembershipId: membership.id,
      locationId,
    })
    .onConflictDoNothing();

  return {
    membershipId: membership.id,
    role: "administrator" as const,
    staffIdentityId: identity.id,
  };
}

async function ensureVerifiedCustomer(
  db: Awaited<ReturnType<typeof createDbClient>>["db"],
) {
  const auth = getCustomerAuth();

  const [existingUser] = await db
    .select()
    .from(customerAuthUsers)
    .where(eq(customerAuthUsers.email, DEMO_CUSTOMER_EMAIL))
    .limit(1);

  if (!existingUser) {
    await auth.api.signUpEmail({
      body: {
        email: DEMO_CUSTOMER_EMAIL,
        password: DEMO_CUSTOMER_PASSWORD,
        name: DEMO_CUSTOMER_NAME,
      },
    });
  }

  await db
    .update(customerAuthUsers)
    .set({ emailVerified: true, name: DEMO_CUSTOMER_NAME })
    .where(eq(customerAuthUsers.email, DEMO_CUSTOMER_EMAIL));
}

async function main() {
  const storefrontPublicId =
    process.argv[2]?.trim() ||
    process.env.QOS_STOREFRONT_PUBLIC_ID?.trim() ||
    DEFAULT_STOREFRONT_PUBLIC_ID;
  const locationPublicId =
    process.argv[3]?.trim() ||
    process.env.QOS_LOCATION_PUBLIC_ID?.trim() ||
    DEFAULT_LOCATION_PUBLIC_ID;

  const { db, sql } = createDbClient();

  const [storefront] = await db
    .select()
    .from(storefronts)
    .where(eq(storefronts.publicId, storefrontPublicId))
    .limit(1);

  if (!storefront) {
    throw new Error(`Storefront not found: ${storefrontPublicId}`);
  }

  const [location] = await db
    .select()
    .from(locations)
    .where(
      eq(locations.publicId, locationPublicId),
    )
    .limit(1);

  if (!location || location.tenantId !== storefront.tenantId) {
    throw new Error(`Location not found for storefront: ${locationPublicId}`);
  }

  const [brand] = await db
    .select()
    .from(brands)
    .where(eq(brands.id, storefront.brandId))
    .limit(1);

  if (!brand) {
    throw new Error("Brand not found for storefront.");
  }

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, storefront.tenantId))
    .limit(1);

  if (!tenant) {
    throw new Error("Tenant not found for storefront.");
  }

  process.env.BETTER_AUTH_SECRET =
    process.env.BETTER_AUTH_SECRET || "local-dev-better-auth-secret-with-length";
  process.env.BETTER_AUTH_URL =
    process.env.BETTER_AUTH_URL || "https://quotes.dev.qosapp.com";

  const admin = await ensureStaffAdmin(db, tenant.id, location.id);

  const product = await createDraftProduct(db, tenant.id, admin, {
    internalName: "quotes-demo-latte",
    translations: {
      en: { displayName: "Demo Latte", description: "Sandbox checkout item" },
      ar: { displayName: "لاتيه تجريبي", description: "عنصر دفع تجريبي" },
    },
    defaultVariant: { amountMinor: 1800, currency: "AED" },
  });

  for (const locale of ["en", "ar"] as const) {
    await approveProductTranslation(
      db,
      tenant.id,
      "seed.checkout-demo@qosapp.com",
      product.publicId,
      locale,
      {
        expectedTranslationVersion: product.translations[locale].translationVersion,
      },
    );
  }

  const menu = await createDraftMenu(db, tenant.id, admin, {
    internalName: "quotes-demo-menu",
    locationIds: [location.id],
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
  });

  await publishDraftMenuToLocations(db, tenant.id, "seed.checkout-demo@qosapp.com", menu.publicId, {
    locationIds: [location.id],
  });

  await assignPublishedCollection(
    db,
    tenant.id,
    storefront.publicId,
    location.publicId,
    menu.publicId,
  );

  await publishStorefrontRelease(
    db,
    tenant.id,
    storefront.publicId,
    "seed.checkout-demo@qosapp.com",
  );

  await db
    .insert(storefrontLocations)
    .values({
      tenantId: tenant.id,
      storefrontId: storefront.id,
      locationId: location.id,
    })
    .onConflictDoNothing();

  await ensureVerifiedCustomer(db);

  console.log(
    JSON.stringify(
      {
        tenantPublicId: tenant.publicId,
        storefrontPublicId: storefront.publicId,
        locationPublicId: location.publicId,
        productPublicId: product.publicId,
        menuPublicId: menu.publicId,
        demoCustomer: {
          email: DEMO_CUSTOMER_EMAIL,
          password: DEMO_CUSTOMER_PASSWORD,
        },
        quotesEnv: {
          QOS_TEST_PRODUCT_PUBLIC_ID: product.publicId,
        },
      },
      null,
      2,
    ),
  );

  await sql.end({ timeout: 5 });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
