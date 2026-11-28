import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { staffAuthUsers, staffIdentities, staffMemberships, workbookImportApplies } from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { flowerTenantFixture } from "@/lib/tenant/fixtures";
import { createQuotesTwoLocationTenant } from "@/lib/tenant/fixtures-two-locations";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import type { ApplyHistoryEntry } from "@/lib/workbook/apply/model";
import { loadWorkbook, saveWorkbook } from "@/lib/workbook/test-support";
import type { PlanDecision, WorkbookReviewResult } from "@/lib/workbook/validation/model";

import { GET as appliesGET } from "./applies/route";
import { POST as applyPOST } from "./plans/[planPublicId]/apply/route";
import { POST as reviewPOST } from "./plans/[planPublicId]/review/route";
import { GET as planGET } from "./plans/[planPublicId]/route";
import { POST as previewPOST } from "./preview/route";
import { GET as templateGET } from "./template/route";

/* QOS-200 follow-up: the tenant's past workbook applies, listed for the
   import page after it is reopened. Administrators only, tenant-scoped,
   newest first, with the actor's display name and never their raw id. */

const staffMocks = vi.hoisted(() => ({ requireStaffIdentity: vi.fn() }));
vi.mock("@/lib/staff/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/staff/auth")>();
  return { ...actual, requireStaffIdentity: staffMocks.requireStaffIdentity };
});

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const ADMIN = "subject-admin-history-7f3a";
const USER = "subject-user-history-2b9c";
const FLOWERS_ADMIN = "subject-flowers-admin-history-5d1e";

const TRUNCATE = `TRUNCATE TABLE qos.workbook_source_links, qos.workbook_import_plan_rows, qos.workbook_import_applies, qos.workbook_import_plans, qos.tenant_audit_events,
  qos.inventory_units, qos.staff_auth_users, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;

integrationDescribe("workbook apply history route (DB)", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sql: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sql = connection.sql;
    await grantRoleMembership(sql, "qos", "qos_app");
  }, 120_000);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql.unsafe(TRUNCATE);
    staffMocks.requireStaffIdentity.mockReset();
  });

  async function seedMember(tenantId: string, subject: string, role: "administrator" | "user", email: string, locationIds: string[] = []) {
    const [identity] = await db.insert(staffIdentities).values({ providerSubject: subject, email }).returning();
    const [membership] = await db.insert(staffMemberships).values({ tenantId, staffIdentityId: identity!.id, role }).returning();
    for (const locationId of locationIds) await sql`INSERT INTO qos.staff_location_scopes (tenant_id, staff_membership_id, location_id) VALUES (${tenantId}, ${membership!.id}, ${locationId})`;
    return membership!;
  }

  async function seed() {
    const quotes = await createQuotesTwoLocationTenant(db);
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    await seedMember(quotes.tenant.id, ADMIN, "administrator", "alice@test");
    await db.insert(staffAuthUsers).values({ id: ADMIN, name: "Alice Admin", email: "alice@test" });
    await seedMember(quotes.tenant.id, USER, "user", "bob@test", [quotes.locationA.id]);
    await seedMember(flowers.tenant.id, FLOWERS_ADMIN, "administrator", "fiona@test");
    return { tenantId: quotes.tenant.id, flowersTenantId: flowers.tenant.id };
  }

  function as(subject: string) {
    staffMocks.requireStaffIdentity.mockResolvedValue({ subject, email: subject });
  }
  const params = (tenantId: string) => ({ params: Promise.resolve({ tenantId }) });
  const planParams = (tenantId: string, planPublicId: string) => ({ params: Promise.resolve({ tenantId, planPublicId }) });
  let keyCounter = 0;
  const nextKey = () => `history-key-${(keyCounter += 1)}`;

  async function ok<T = WorkbookReviewResult>(response: Response) {
    const body = await response.json();
    expect(response.status, JSON.stringify(body).slice(0, 800)).toBe(200);
    return body as T;
  }

  /** A blank template with one custom unit row, applied end to end as the administrator. */
  async function applyUnit(tenantId: string, code: string, name: string, fileName: string) {
    as(ADMIN);
    const template = await templateGET(new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/template`), params(tenantId));
    const workbook = await loadWorkbook(Buffer.from(await template.arrayBuffer()));
    const sheet = workbook.getWorksheet("Units")!;
    const columns = new Map<string, number>();
    sheet.getRow(6).eachCell((cell, column) => columns.set(String(cell.value), column));
    const values: Record<string, string> = { unit_key: `u-${code}`, action: "create", code, name, name_ar: name === "Crate" ? "صندوق" : "صينية", quantity_kind: "PACK", decimal_places: "0", active: "TRUE" };
    for (const [key, value] of Object.entries(values)) sheet.getCell(7, columns.get(key)!).value = value;
    const form = new FormData();
    form.set("file", new File([new Uint8Array(await saveWorkbook(workbook))], fileName));
    let plan = await ok(await previewPOST(new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/preview`, { method: "POST", body: form, headers: { "Idempotency-Key": nextKey() } }), params(tenantId)));
    if (!plan.readiness.reviewComplete) {
      const decisions: PlanDecision[] = plan.acknowledgements.required.map((ack) => (ack.kind === "acknowledge_deferred" ? { kind: "acknowledge_deferred", sheet: ack.sheet!, column: ack.column! } : { kind: ack.kind }));
      plan = await ok(
        await reviewPOST(
          new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/plans/${plan.plan.publicId}/review`, { method: "POST", body: JSON.stringify({ expectedPlanHash: plan.plan.planHash, decisions }), headers: { "content-type": "application/json" } }),
          planParams(tenantId, plan.plan.publicId),
        ),
      );
    }
    const applied = await ok(
      await applyPOST(
        new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/plans/${plan.plan.publicId}/apply`, {
          method: "POST",
          headers: { "content-type": "application/json", "Idempotency-Key": nextKey() },
          body: JSON.stringify({ expectedPlanHash: plan.plan.planHash }),
        }),
        planParams(tenantId, plan.plan.publicId),
      ),
    );
    expect(applied.plan.status).toBe("applied");
    return applied;
  }

  async function history(subject: string, tenantId: string, query = "") {
    as(subject);
    return appliesGET(new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/applies${query}`), params(tenantId));
  }

  it("lists the tenant's past applies newest first with file name, counts and the actor's name, for administrators only", async () => {
    const { tenantId, flowersTenantId } = await seed();
    const first = await applyUnit(tenantId, "crate", "Crate", "first-units.xlsx");
    const second = await applyUnit(tenantId, "tray", "Tray", "second-units.xlsx");

    const response = await history(ADMIN, tenantId);
    expect(response.headers.get("cache-control")).toContain("private");
    const text = await response.text();
    expect(response.status).toBe(200);
    // Never a raw subject in the response.
    expect(text).not.toContain(ADMIN);
    const { applies } = JSON.parse(text) as { applies: ApplyHistoryEntry[] };
    expect(applies.map((entry) => entry.planPublicId)).toEqual([second.plan.publicId, first.plan.publicId]);
    expect(applies[0]).toMatchObject({
      publicId: second.apply!.attempts[0]!.publicId,
      status: "completed",
      fileName: "second-units.xlsx",
      actorDisplayName: "Alice Admin",
      actorRole: "administrator",
      counts: expect.objectContaining({ applied: 1, failed: 0 }),
    });
    expect(Date.parse(applies[0]!.startedAt)).not.toBeNaN();
    expect(Date.parse(applies[0]!.finishedAt!)).not.toBeNaN();
    expect(applies[1]).toMatchObject({ fileName: "first-units.xlsx", actorDisplayName: "Alice Admin" });

    // Limited, newest first.
    const limited = await ok<{ applies: ApplyHistoryEntry[] }>(await history(ADMIN, tenantId, "?limit=1"));
    expect(limited.applies.map((entry) => entry.planPublicId)).toEqual([second.plan.publicId]);

    // A user may not list applies; another tenant sees none of these.
    const forbidden = await history(USER, tenantId);
    expect(forbidden.status).toBe(403);
    expect((await ok<{ applies: ApplyHistoryEntry[] }>(await history(FLOWERS_ADMIN, flowersTenantId))).applies).toEqual([]);
    // Not a member of this business: not found, as on every tenant route.
    expect((await history(FLOWERS_ADMIN, tenantId)).status).toBe(404);

    // The plan view's own history shows the name too.
    as(ADMIN);
    const plan = await ok(await planGET(new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/plans/${first.plan.publicId}`), planParams(tenantId, first.plan.publicId)));
    expect(plan.apply!.attempts[0]!.actorDisplayName).toBe("Alice Admin");
    expect(plan.rows[0]!.apply).toMatchObject({ state: "applied" });

    // An actor who is not (or no longer) a member of this business has no name here: the UI shows a neutral label.
    await db.update(workbookImportApplies).set({ actorSubject: "subject-gone-9e8d" }).where(eq(workbookImportApplies.publicId, first.apply!.attempts[0]!.publicId));
    const after = await ok<{ applies: ApplyHistoryEntry[] }>(await history(ADMIN, tenantId));
    expect(after.applies.find((entry) => entry.planPublicId === first.plan.publicId)!.actorDisplayName).toBeNull();
    expect(JSON.stringify(after)).not.toContain("subject-gone-9e8d");
  });

  it("answers 401 without a staff session", async () => {
    const { tenantId } = await seed();
    vi.stubEnv("STAFF_BETTER_AUTH_SECRET", "qos200fu-history-test-secret-qos200fu-history");
    const actual = await vi.importActual<typeof import("@/lib/staff/auth")>("@/lib/staff/auth");
    staffMocks.requireStaffIdentity.mockImplementation(actual.requireStaffIdentity);
    const response = await appliesGET(new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/applies`), params(tenantId));
    expect(response.status).toBe(401);
    vi.unstubAllEnvs();
  });
});
