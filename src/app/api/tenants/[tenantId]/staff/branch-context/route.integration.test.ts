import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { locations, staffIdentities, staffLocationScopes, staffMemberships, tenants } from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { flowerTenantFixture } from "@/lib/tenant/fixtures";
import { createQuotesTwoLocationTenant } from "@/lib/tenant/fixtures-two-locations";
import { createTenantHierarchy } from "@/lib/tenant/repository";

import { GET } from "./route";

const staffMocks = vi.hoisted(() => ({
  requireStaffIdentity: vi.fn(),
}));

vi.mock("@/lib/staff/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/staff/auth")>();
  return {
    ...actual,
    requireStaffIdentity: staffMocks.requireStaffIdentity,
  };
});

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const ADMIN = "admin.branch-context@test";
const USER_ONE_SCOPE = "user.one-scope@test";
const USER_TWO_SCOPES = "user.two-scopes@test";
const FLOWERS_ADMIN = "admin.flowers.branch-context@test";

integrationDescribe("GET /api/tenants/[tenantId]/staff/branch-context (DB)", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
    await grantRoleMembership(sqlClient, "qos", "qos_app");
  });

  afterAll(async () => {
    await sqlClient.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.tenant_audit_events, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
    staffMocks.requireStaffIdentity.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function seedMember(
    tenantId: string,
    subject: string,
    role: "administrator" | "user",
    scopedLocationIds: string[] = [],
  ) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: subject, email: subject })
      .returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity.id, role })
      .returning();
    for (const locationId of scopedLocationIds) {
      await db
        .insert(staffLocationScopes)
        .values({ tenantId, staffMembershipId: membership.id, locationId });
    }
  }

  async function seed() {
    const quotes = await createQuotesTwoLocationTenant(db);
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    await seedMember(quotes.tenant.id, ADMIN, "administrator");
    await seedMember(quotes.tenant.id, USER_ONE_SCOPE, "user", [quotes.locationA.id]);
    await seedMember(quotes.tenant.id, USER_TWO_SCOPES, "user", [quotes.locationA.id, quotes.locationB.id]);
    await seedMember(flowers.tenant.id, FLOWERS_ADMIN, "administrator");
    return { quotesId: quotes.tenant.id, flowersId: flowers.tenant.id };
  }

  async function call(
    tenantId: string,
    subject: string,
    query = "",
    headers: Record<string, string> = {},
  ) {
    staffMocks.requireStaffIdentity.mockResolvedValue({ subject, email: subject });
    return GET(
      new Request(`http://localhost/api/tenants/${tenantId}/staff/branch-context${query}`, { headers }),
      { params: Promise.resolve({ tenantId }) },
    );
  }

  it("returns 401 with the real session check when there is no staff session", async () => {
    const { quotesId } = await seed();
    vi.stubEnv("STAFF_BETTER_AUTH_SECRET", "qos192-route-test-secret-qos192-route-test");
    const actual = await vi.importActual<typeof import("@/lib/staff/auth")>("@/lib/staff/auth");
    staffMocks.requireStaffIdentity.mockImplementation(actual.requireStaffIdentity);

    const anonymous = await GET(new Request(`http://localhost/api/tenants/${quotesId}/staff/branch-context`), {
      params: Promise.resolve({ tenantId: quotesId }),
    });
    expect(anonymous.status).toBe(401);

    const forged = await GET(
      new Request(`http://localhost/api/tenants/${quotesId}/staff/branch-context`, {
        headers: { cookie: "qos-staff.session_token=forged.value" },
      }),
      { params: Promise.resolve({ tenantId: quotesId }) },
    );
    expect(forged.status).toBe(401);
    expect(((await forged.json()) as { branches?: unknown }).branches).toBeUndefined();
  });

  it("returns the administrator's branches, All branches and the unmapped business labels", async () => {
    const { quotesId } = await seed();

    const response = await call(quotesId, ADMIN);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toEqual({
      baseCurrency: "AED",
      role: "administrator",
      branches: [
        { publicId: "loc_quotes_hbz", name: "HBZ Stadium", status: "active", timezone: "Asia/Dubai", currency: "AED" },
        { publicId: "loc_quotes_hct", name: "HCT Academic City", status: "active", timezone: "Asia/Dubai", currency: "AED" },
      ],
      allBranchesAllowed: true,
      defaultSelection: "all",
      requestedBusinessLabels: [
        { key: "dubai", label: "Dubai", mappingStatus: "unmapped", locationPublicId: null },
        { key: "al-ain", label: "Al Ain", mappingStatus: "unmapped", locationPublicId: null },
        { key: "azur-cafe", label: "Azur Cafe", mappingStatus: "unmapped", locationPublicId: null },
      ],
    });
  });

  it("accepts a permitted branch deep link and All branches for an administrator", async () => {
    const { quotesId } = await seed();

    const single = await call(quotesId, ADMIN, "?branch=loc_quotes_hct");
    expect(single.status).toBe(200);
    expect(((await single.json()) as { selected: string }).selected).toBe("loc_quotes_hct");

    const all = await call(quotesId, ADMIN, "?branch=all");
    expect(all.status).toBe(200);
    expect(((await all.json()) as { selected: string }).selected).toBe("all");
  });

  it("returns 403 when a user asks for a branch outside their scope", async () => {
    const { quotesId } = await seed();

    const own = await call(quotesId, USER_ONE_SCOPE, "?branch=loc_quotes_hbz");
    expect(own.status).toBe(200);

    const unscoped = await call(quotesId, USER_ONE_SCOPE, "?branch=loc_quotes_hct");
    expect(unscoped.status).toBe(403);
    const body = (await unscoped.json()) as { branches?: unknown; error: string };
    expect(body.branches).toBeUndefined();

    // Another tenant's location and a location that does not exist look the same.
    expect((await call(quotesId, USER_ONE_SCOPE, "?branch=loc_flowers_main")).status).toBe(403);
    expect((await call(quotesId, USER_ONE_SCOPE, "?branch=loc_missing")).status).toBe(403);
    expect((await call(quotesId, USER_ONE_SCOPE, "?branch=")).status).toBe(403);
  });

  it("never gives All branches to a single-scope user", async () => {
    const { quotesId } = await seed();

    const response = await call(quotesId, USER_ONE_SCOPE);
    const body = (await response.json()) as { allBranchesAllowed: boolean; branches: Array<{ publicId: string }>; defaultSelection: string };
    expect(body.allBranchesAllowed).toBe(false);
    expect(body.branches.map((branch) => branch.publicId)).toEqual(["loc_quotes_hbz"]);
    expect(body.defaultSelection).toBe("loc_quotes_hbz");

    expect((await call(quotesId, USER_ONE_SCOPE, "?branch=all")).status).toBe(403);
  });

  it("allows All branches for reads to a user with several scopes", async () => {
    const { quotesId } = await seed();

    const response = await call(quotesId, USER_TWO_SCOPES, "?branch=all");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { allBranchesAllowed: boolean; selected: string; role: string };
    expect(body).toMatchObject({ allBranchesAllowed: true, selected: "all", role: "user" });
  });

  it("ignores client-supplied role hints", async () => {
    const { quotesId } = await seed();

    const response = await call(quotesId, USER_ONE_SCOPE, "?role=administrator&allBranchesAllowed=true", {
      "x-qos-role": "administrator",
    });
    const body = (await response.json()) as { role: string; allBranchesAllowed: boolean; branches: unknown[] };
    expect(body.role).toBe("user");
    expect(body.allBranchesAllowed).toBe(false);
    expect(body.branches).toHaveLength(1);

    const escalate = await call(quotesId, USER_ONE_SCOPE, "?branch=loc_quotes_hct&role=administrator", {
      "x-qos-role": "administrator",
    });
    expect(escalate.status).toBe(403);
  });

  it("returns 404 for another tenant, an unknown tenant and a malformed tenant id", async () => {
    const { quotesId, flowersId } = await seed();

    const crossTenant = await call(quotesId, FLOWERS_ADMIN);
    expect(crossTenant.status).toBe(404);
    expect(((await crossTenant.json()) as { branches?: unknown }).branches).toBeUndefined();

    // A deep link carrying a real branch of the other tenant changes nothing.
    expect((await call(flowersId, ADMIN, "?branch=loc_flowers_main")).status).toBe(404);
    expect((await call("00000000-0000-4000-8000-000000000000", ADMIN)).status).toBe(404);
    expect((await call("../../platform", ADMIN)).status).toBe(404);
  });

  it("keeps the existing tenant_inactive response for members of a suspended business", async () => {
    const { quotesId } = await seed();
    await db.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, quotesId));

    const response = await call(quotesId, ADMIN);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "tenant_inactive" });
  });

  it("does not change any location row or write audit events", async () => {
    const { quotesId } = await seed();
    const before = await db.select().from(locations).orderBy(locations.publicId);

    await call(quotesId, ADMIN, "?branch=all");
    await call(quotesId, USER_ONE_SCOPE, "?branch=loc_quotes_hct");

    expect(await db.select().from(locations).orderBy(locations.publicId)).toEqual(before);
    const [{ count }] = await sqlClient`SELECT count(*)::int AS count FROM qos.tenant_audit_events`;
    expect(count).toBe(0);
  });
});
