import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  customerAuthUsers,
  staffAuthUsers,
  staffInvitationLocations,
  staffInvitations,
} from "@/db/schema";
import {
  hasIntegrationDatabase,
  integrationDatabaseUrl,
  resetAndMigrate,
} from "@/db/test-utils";
import { getCustomerAuth } from "@/lib/customer/auth-server";
import {
  requireActiveStaffMembership,
  requireAdministratorMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";
import { getStaffAuth } from "@/lib/staff/auth-server";
import {
  buildStaffInvitationExpiry,
  generateStaffInvitationToken,
  redeemStaffInvitation,
} from "@/lib/staff/invitations";
import {
  changeStaffMembershipRole,
  revokeStaffMembership,
  STAFF_MEMBERSHIP_REVOCATION_INTERVAL_MS,
} from "@/lib/staff/memberships";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

function extractStaffSessionCookie(setCookieHeader: string | null) {
  if (!setCookieHeader) {
    return "";
  }

  const match = setCookieHeader.match(/qos-staff\.session_token=([^;]+)/);
  return match ? `qos-staff.session_token=${match[1]}` : "";
}

function extractCustomerSessionCookie(setCookieHeader: string | null) {
  if (!setCookieHeader) {
    return "";
  }

  const match = setCookieHeader.match(/better-auth\.session_token=([^;]+)/);
  return match ? `better-auth.session_token=${match[1]}` : "";
}

let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

integrationDescribe("staff authentication and membership enforcement", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = integrationDatabaseUrl;
    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-with-enough-length-for-validation";
    process.env.BETTER_AUTH_URL = "http://localhost:3000";

    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
  });

  afterAll(async () => {
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.BETTER_AUTH_URL;
    await sqlClient.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.staff_invitation_locations, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.staff_auth_verifications, qos.staff_auth_accounts, qos.staff_auth_sessions, qos.staff_auth_users, qos.customer_auth_verifications, qos.customer_auth_accounts, qos.customer_auth_sessions, qos.customer_auth_users, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function registerStaff(email: string, password: string, name: string) {
    const auth = getStaffAuth();
    await auth.api.signUpEmail({
      body: { email, password, name },
    });

    await db
      .update(staffAuthUsers)
      .set({ emailVerified: true })
      .where(eq(staffAuthUsers.email, email));
  }

  async function signInStaff(email: string, password: string, path = "/api/staff/me/memberships") {
    const auth = getStaffAuth();
    const response = await auth.api.signInEmail({
      body: { email, password, rememberMe: true },
      asResponse: true,
    });

    const cookie = extractStaffSessionCookie(response.headers.get("set-cookie"));
    return new Request(`http://localhost${path}`, {
      headers: { Cookie: cookie },
    });
  }

  async function registerCustomer(email: string, password: string, name: string) {
    const auth = getCustomerAuth();
    await auth.api.signUpEmail({
      body: { email, password, name },
    });

    await db
      .update(customerAuthUsers)
      .set({ emailVerified: true })
      .where(eq(customerAuthUsers.email, email));
  }

  async function signInCustomer(email: string, password: string) {
    const auth = getCustomerAuth();
    const response = await auth.api.signInEmail({
      body: { email, password, rememberMe: true },
      asResponse: true,
    });

    const cookie = extractCustomerSessionCookie(response.headers.get("set-cookie"));
    return new Request("http://localhost/api/tenants/test/catalogue/products", {
      headers: { Cookie: cookie },
    });
  }

  async function seedInvitation(input: {
    tenantId: string;
    locationId: string;
    email: string;
    role?: "administrator" | "user";
  }) {
    const { token, tokenHash } = generateStaffInvitationToken();

    const [invitation] = await db
      .insert(staffInvitations)
      .values({
        tenantId: input.tenantId,
        email: input.email,
        role: input.role ?? "administrator",
        invitedByOperatorId: "operator@test",
        tokenHash,
        expiresAt: buildStaffInvitationExpiry(),
      })
      .returning();

    await db.insert(staffInvitationLocations).values({
      tenantId: input.tenantId,
      invitationId: invitation.id,
      locationId: input.locationId,
    });

    return { token, invitation };
  }

  it("redeems an invitation for a verified staff session and grants membership", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const { token } = await seedInvitation({
      tenantId: quotes.tenant.id,
      locationId: quotes.location.id,
      email: "staff.admin@qosapp.test",
    });

    await registerStaff("staff.admin@qosapp.test", "Password123!", "Staff Admin");
    const request = await signInStaff("staff.admin@qosapp.test", "Password123!");
    const identity = await requireStaffIdentity(request);

    const redemption = await redeemStaffInvitation(db, { token, identity });

    expect(redemption.idempotentReplay).toBe(false);
    expect(redemption.role).toBe("administrator");
    expect(redemption.tenantId).toBe(quotes.tenant.id);

    const replay = await redeemStaffInvitation(db, { token, identity });
    expect(replay.idempotentReplay).toBe(true);
  });

  it("revokes membership immediately on the next protected lookup", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());

    const { token: adminToken } = await seedInvitation({
      tenantId: quotes.tenant.id,
      locationId: quotes.location.id,
      email: "staff.admin@qosapp.test",
      role: "administrator",
    });
    const { token: userToken } = await seedInvitation({
      tenantId: quotes.tenant.id,
      locationId: quotes.location.id,
      email: "staff.user@qosapp.test",
      role: "user",
    });

    await registerStaff("staff.admin@qosapp.test", "Password123!", "Staff Admin");
    await registerStaff("staff.user@qosapp.test", "Password123!", "Staff User");

    const adminRequest = await signInStaff("staff.admin@qosapp.test", "Password123!");
    const adminIdentity = await requireStaffIdentity(adminRequest);
    const adminRedemption = await redeemStaffInvitation(db, {
      token: adminToken,
      identity: adminIdentity,
    });

    const userRequest = await signInStaff("staff.user@qosapp.test", "Password123!");
    const userIdentity = await requireStaffIdentity(userRequest);
    const userRedemption = await redeemStaffInvitation(db, {
      token: userToken,
      identity: userIdentity,
    });

    await revokeStaffMembership(db, quotes.tenant.id, userRedemption.membershipId, {
      membershipId: adminRedemption.membershipId,
      role: "administrator",
      staffIdentityId: adminRedemption.staffIdentityId,
    });

    expect(STAFF_MEMBERSHIP_REVOCATION_INTERVAL_MS).toBe(0);

    await expect(
      requireActiveStaffMembership(db, quotes.tenant.id, userIdentity.subject),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("denies customer sessions for staff identity resolution", async () => {
    await registerCustomer("customer@qosapp.test", "Password123!", "Customer");
    const customerRequest = await signInCustomer("customer@qosapp.test", "Password123!");

    await expect(requireStaffIdentity(customerRequest)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("prevents demoted administrators from administrator-only actions", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());

    const { token: primaryAdminToken } = await seedInvitation({
      tenantId: quotes.tenant.id,
      locationId: quotes.location.id,
      email: "staff.admin@qosapp.test",
      role: "administrator",
    });
    const { token: secondaryAdminToken } = await seedInvitation({
      tenantId: quotes.tenant.id,
      locationId: quotes.location.id,
      email: "staff.admin2@qosapp.test",
      role: "administrator",
    });

    await registerStaff("staff.admin@qosapp.test", "Password123!", "Staff Admin");
    await registerStaff("staff.admin2@qosapp.test", "Password123!", "Staff Admin Two");

    const primaryRequest = await signInStaff("staff.admin@qosapp.test", "Password123!");
    const primaryIdentity = await requireStaffIdentity(primaryRequest);
    const primaryRedemption = await redeemStaffInvitation(db, {
      token: primaryAdminToken,
      identity: primaryIdentity,
    });

    const secondaryRequest = await signInStaff("staff.admin2@qosapp.test", "Password123!");
    const secondaryIdentity = await requireStaffIdentity(secondaryRequest);
    const secondaryRedemption = await redeemStaffInvitation(db, {
      token: secondaryAdminToken,
      identity: secondaryIdentity,
    });

    await changeStaffMembershipRole(
      db,
      quotes.tenant.id,
      secondaryRedemption.membershipId,
      "user",
      {
        membershipId: primaryRedemption.membershipId,
        role: "administrator",
        staffIdentityId: primaryRedemption.staffIdentityId,
      },
    );

    await expect(
      requireAdministratorMembership(db, quotes.tenant.id, secondaryIdentity.subject),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
