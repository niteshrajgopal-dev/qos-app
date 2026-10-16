import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { agentRuns, aiJobs, staffIdentities, staffLocationScopes, staffMemberships } from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate, runAsRole } from "@/db/test-utils";
import { readAgentConfig } from "@/lib/agents/config";
import {
  askMenuManager,
  refreshMenuManagerRun,
} from "@/lib/agents/menu-manager/menu-manager-service";
import { WORKER_STOPPED_MID_REVIEW_CODE } from "@/lib/agents/menu-manager/menu-manager-worker-limits";
import { QOS_WAIT_DEADLINE_CODE } from "@/lib/agents/agent-runs";
import { readAiSpendPolicy } from "@/lib/ai/spend/spend-policy";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { createDraftProduct } from "@/lib/catalogue/products";
import { requireActiveStaffMembership } from "@/lib/staff/auth";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const NATIVE_ENV = {
  AGENT_NATIVE_MODEL_PROVIDER: "mock",
  AGENT_NATIVE_MODEL: "fake-model",
  NODE_ENV: "test",
  AI_SPEND_PLATFORM_CONCURRENCY: "10",
  AI_SPEND_PROVIDER_OPENAI_CONCURRENCY: "10",
  AI_SPEND_MENU_MANAGER_NATIVE_ENABLED: "true",
  AI_SPEND_MENU_MANAGER_NATIVE_MAX_UNITS_PER_RUN: "1",
  AI_SPEND_MENU_MANAGER_NATIVE_TENANT_DAILY_UNITS: "10",
  AI_SPEND_MENU_MANAGER_NATIVE_TENANT_MONTHLY_UNITS: "100",
  AI_SPEND_MENU_MANAGER_NATIVE_TENANT_CONCURRENCY: "10",
  AI_SPEND_MENU_MANAGER_NATIVE_PLATFORM_DAILY_UNITS: "20",
  AI_SPEND_MENU_MANAGER_NATIVE_PLATFORM_MONTHLY_UNITS: "100",
  AI_SPEND_MENU_MANAGER_NATIVE_UNSTARTED_EXPIRY_MS: "600000",
};
const NATIVE_QUEUED = readAgentConfig({
  AGENTS_ENABLED: "true",
  AGENT_MENU_MANAGER_ENABLED: "true",
  AGENT_MENU_MANAGER_EXECUTOR: "native",
  AGENT_MENU_MANAGER_EXECUTION_MODE: "queued_worker",
  AGENT_RUN_TIMEOUT_MS: "120000",
});
const spendPolicy = () => readAiSpendPolicy(NATIVE_ENV);

const REQUESTER = "admin.quotes@test";

integrationDescribe("Menu Manager queued_worker deadlines on read", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
    await grantRoleMembership(sqlClient, "qos", "qos_app");
  }, 120_000);

  afterAll(async () => {
    await sqlClient.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.ai_job_attempts, qos.ai_jobs, qos.agent_run_inputs, qos.agent_runs, qos.tenant_agent_bindings, qos.ai_spend_reservations, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seed() {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const tenantId = quotes.tenant.id;
    const [identity] = await db.insert(staffIdentities).values({ providerSubject: REQUESTER, email: REQUESTER }).returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity!.id, role: "administrator" })
      .returning();
    await db.insert(staffLocationScopes).values({ tenantId, staffMembershipId: membership!.id, locationId: quotes.location.id });
    const actor = { membershipId: membership!.id, role: "administrator" as const, staffIdentityId: identity!.id };
    const product = await createDraftProduct(db, tenantId, actor, {
      internalName: "latte",
      translations: { en: { displayName: "Latte", description: "d" }, ar: { displayName: "l", description: "w" } },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    });
    const menu = await createDraftMenu(db, tenantId, actor, {
      internalName: "breakfast",
      locationIds: [quotes.location.id],
      translations: { en: { displayName: "Breakfast" }, ar: { displayName: "f" } },
      sections: [
        {
          internalName: "coffee",
          sortOrder: 0,
          translations: { en: { displayName: "Coffee" }, ar: { displayName: "q" } },
          products: [{ productPublicId: product.publicId, sortOrder: 0 }],
        },
      ],
    });
    const caller = {
      tenantId,
      subject: REQUESTER,
      membership: await runAsRole(sqlClient, "qos_app", () => requireActiveStaffMembership(db, tenantId, REQUESTER)),
    };
    return { menu, caller };
  }

  it("fails a queued run past its deadline on GET when no worker ever claimed the job", async () => {
    const { menu, caller } = await seed();
    const { run } = await runAsRole(sqlClient, "qos_app", () =>
      askMenuManager(db, caller, { menuPublicId: menu.publicId, idempotencyKey: `idem-${randomBytes(6).toString("hex")}` }, {
        config: NATIVE_QUEUED,
        spendPolicy: spendPolicy(),
        env: NATIVE_ENV,
      }),
    );
    const pastDeadline = new Date(Date.parse(run.createdAt) + 130_000);
    const view = await runAsRole(sqlClient, "qos_app", () =>
      refreshMenuManagerRun(db, caller, { menuPublicId: menu.publicId, runPublicId: run.publicId }, {
        config: NATIVE_QUEUED,
        now: () => pastDeadline,
      }),
    );
    expect(view.status).toBe("failed");
    expect(view.failureCode).toBe("not_started_in_time");
  });

  it("fails a running run past deadlineAt on GET", async () => {
    const { menu, caller } = await seed();
    const { run } = await runAsRole(sqlClient, "qos_app", () =>
      askMenuManager(db, caller, { menuPublicId: menu.publicId, idempotencyKey: `idem-${randomBytes(6).toString("hex")}` }, {
        config: NATIVE_QUEUED,
        spendPolicy: spendPolicy(),
        env: NATIVE_ENV,
      }),
    );
    const [row] = await db.select().from(agentRuns).where(eq(agentRuns.publicId, run.publicId));
    await db
      .update(agentRuns)
      .set({
        status: "running",
        providerThreadId: `native:${run.publicId}`,
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() - 1_000),
      })
      .where(eq(agentRuns.id, row!.id));

    const view = await runAsRole(sqlClient, "qos_app", () =>
      refreshMenuManagerRun(db, caller, { menuPublicId: menu.publicId, runPublicId: run.publicId }, {
        config: NATIVE_QUEUED,
      }),
    );
    expect(view.status).toBe("failed");
    expect(view.failureCode).toBe(QOS_WAIT_DEADLINE_CODE);
  });

  it("fails a running run when the worker job is queued without an active lease for too long", async () => {
    const { menu, caller } = await seed();
    const { run } = await runAsRole(sqlClient, "qos_app", () =>
      askMenuManager(db, caller, { menuPublicId: menu.publicId, idempotencyKey: `idem-${randomBytes(6).toString("hex")}` }, {
        config: NATIVE_QUEUED,
        spendPolicy: spendPolicy(),
        env: NATIVE_ENV,
      }),
    );
    const [row] = await db.select().from(agentRuns).where(eq(agentRuns.publicId, run.publicId));
    await db
      .update(agentRuns)
      .set({
        status: "running",
        providerThreadId: `native:${run.publicId}`,
        startedAt: new Date(Date.now() - 600_000),
      })
      .where(eq(agentRuns.id, row!.id));
    await db
      .update(aiJobs)
      .set({
        status: "queued",
        leaseToken: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: new Date(Date.now() - 600_000),
      })
      .where(eq(aiJobs.agentRunId, row!.id));

    const view = await runAsRole(sqlClient, "qos_app", () =>
      refreshMenuManagerRun(db, caller, { menuPublicId: menu.publicId, runPublicId: run.publicId }, {
        config: NATIVE_QUEUED,
      }),
    );
    expect(view.status).toBe("failed");
    expect(view.failureCode).toBe(WORKER_STOPPED_MID_REVIEW_CODE);
  });
});
