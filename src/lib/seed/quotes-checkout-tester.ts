import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "better-auth/crypto";

import type { DbClient } from "@/db/client";
import {
  customerAuthAccounts,
  customerAuthUsers,
  staffAuthUsers,
  storefrontCustomerAssociations,
  storefrontDomains,
  storefronts,
} from "@/db/schema";
import { getCustomerAuth } from "@/lib/customer/auth-server";
import type { EnvSource } from "@/lib/env";
import { assertDevOnlySeedTarget } from "@/lib/seed/dev-only-environment";
import { withTenantContext } from "@/lib/tenant/context";

/**
 * DEV seed identity for the Quotes authenticated checkout journey.
 * The password is a seed input only. Application routes must not import this module.
 */
export const QUOTES_CHECKOUT_TESTER = {
  email: "checkout.tester@qosapp.com",
  password: "QuotesCheckout!2026",
  displayName: "Checkout Tester",
  role: "CUSTOMER" as const,
  status: "ACTIVE" as const,
};

export const QUOTES_DEV_STOREFRONT_PUBLIC_ID = "stf_quotes_e748d7fc";
export const QUOTES_DEV_STOREFRONT_HOSTNAME = "quotes.dev.qosapp.com";

const CREDENTIAL_PROVIDER = "credential";

export type QuotesCheckoutTesterSeedResult = {
  userId: string;
  email: string;
  displayName: string;
  role: typeof QUOTES_CHECKOUT_TESTER.role;
  status: typeof QUOTES_CHECKOUT_TESTER.status;
  emailVerified: true;
  created: boolean;
  storefrontPublicId: string | null;
  associationStatus: "active" | null;
};

async function findQuotesStorefront(db: DbClient, storefrontPublicId?: string) {
  const publicId = storefrontPublicId?.trim() || QUOTES_DEV_STOREFRONT_PUBLIC_ID;
  const [byPublicId] = await db
    .select()
    .from(storefronts)
    .where(eq(storefronts.publicId, publicId))
    .limit(1);

  if (byPublicId) {
    return byPublicId;
  }

  if (storefrontPublicId?.trim()) {
    return null;
  }

  const [domain] = await db
    .select()
    .from(storefrontDomains)
    .where(eq(storefrontDomains.hostname, QUOTES_DEV_STOREFRONT_HOSTNAME))
    .limit(1);

  if (!domain) {
    return null;
  }

  const [byDomain] = await db
    .select()
    .from(storefronts)
    .where(eq(storefronts.id, domain.storefrontId))
    .limit(1);

  return byDomain ?? null;
}

async function ensureCredentialPassword(
  db: DbClient,
  userId: string,
  password: string,
) {
  const passwordHash = await hashPassword(password);

  if (
    passwordHash === password ||
    passwordHash.includes(password) ||
    !(await verifyPassword({ hash: passwordHash, password }))
  ) {
    throw new Error("Customer password hashing did not produce a verifiable hash.");
  }

  const [account] = await db
    .select()
    .from(customerAuthAccounts)
    .where(
      and(
        eq(customerAuthAccounts.userId, userId),
        eq(customerAuthAccounts.providerId, CREDENTIAL_PROVIDER),
      ),
    )
    .limit(1);

  if (!account) {
    await db.insert(customerAuthAccounts).values({
      id: randomUUID(),
      userId,
      accountId: userId,
      providerId: CREDENTIAL_PROVIDER,
      password: passwordHash,
    });
  } else if (account.password !== passwordHash) {
    await db
      .update(customerAuthAccounts)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(eq(customerAuthAccounts.id, account.id));
  }

  const [stored] = await db
    .select({ password: customerAuthAccounts.password })
    .from(customerAuthAccounts)
    .where(
      and(
        eq(customerAuthAccounts.userId, userId),
        eq(customerAuthAccounts.providerId, CREDENTIAL_PROVIDER),
      ),
    )
    .limit(1);

  if (
    !stored?.password ||
    stored.password === password ||
    stored.password.includes(password) ||
    !(await verifyPassword({ hash: stored.password, password }))
  ) {
    throw new Error("Stored customer credential is not a password hash.");
  }
}

async function ensureActiveAssociation(
  db: DbClient,
  userId: string,
  storefront: { id: string; tenantId: string; publicId: string },
) {
  return withTenantContext(db, storefront.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(storefrontCustomerAssociations)
      .where(
        and(
          eq(storefrontCustomerAssociations.tenantId, storefront.tenantId),
          eq(storefrontCustomerAssociations.customerUserId, userId),
        ),
      )
      .limit(1);

    if (!existing) {
      const [created] = await tx
        .insert(storefrontCustomerAssociations)
        .values({
          tenantId: storefront.tenantId,
          storefrontId: storefront.id,
          customerUserId: userId,
          status: "active",
        })
        .returning();

      return created;
    }

    if (existing.storefrontId !== storefront.id) {
      throw new Error(
        "Checkout tester is already associated with a different storefront in this tenant.",
      );
    }

    if (existing.status === "active") {
      return existing;
    }

    const [reactivated] = await tx
      .update(storefrontCustomerAssociations)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(storefrontCustomerAssociations.id, existing.id))
      .returning();

    return reactivated;
  });
}

export async function ensureQuotesCheckoutTester(
  db: DbClient,
  input?: {
    env?: EnvSource;
    storefrontPublicId?: string;
  },
): Promise<QuotesCheckoutTesterSeedResult> {
  assertDevOnlySeedTarget(input?.env ?? process.env);

  const email = QUOTES_CHECKOUT_TESTER.email;
  const password = QUOTES_CHECKOUT_TESTER.password;
  const displayName = QUOTES_CHECKOUT_TESTER.displayName;

  const [staffUser] = await db
    .select({ id: staffAuthUsers.id })
    .from(staffAuthUsers)
    .where(eq(staffAuthUsers.email, email))
    .limit(1);

  if (staffUser) {
    throw new Error("Checkout tester email is already a staff account.");
  }

  const [existing] = await db
    .select()
    .from(customerAuthUsers)
    .where(eq(customerAuthUsers.email, email))
    .limit(1);

  let created = false;
  let userId = existing?.id;

  if (!userId) {
    const auth = getCustomerAuth();
    const signedUp = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name: displayName,
      },
    });
    userId = signedUp.user.id;
    created = true;
  }

  await db
    .update(customerAuthUsers)
    .set({
      emailVerified: true,
      name: displayName,
      updatedAt: new Date(),
    })
    .where(eq(customerAuthUsers.id, userId));

  await ensureCredentialPassword(db, userId, password);

  const [user] = await db
    .select()
    .from(customerAuthUsers)
    .where(eq(customerAuthUsers.id, userId))
    .limit(1);

  if (!user?.emailVerified || user.name !== displayName || user.email !== email) {
    throw new Error("Checkout tester profile was not stored as an active verified customer.");
  }

  const storefront = await findQuotesStorefront(db, input?.storefrontPublicId);
  const association = storefront
    ? await ensureActiveAssociation(db, user.id, storefront)
    : null;

  if (association && association.status !== "active") {
    throw new Error("Checkout tester association is not active.");
  }

  return {
    userId: user.id,
    email: user.email,
    displayName: user.name,
    role: QUOTES_CHECKOUT_TESTER.role,
    status: QUOTES_CHECKOUT_TESTER.status,
    emailVerified: true,
    created,
    storefrontPublicId: storefront?.publicId ?? null,
    associationStatus: association ? "active" : null,
  };
}
