import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  agentRunInputs,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
  tenantAuditEvents,
  tenants,
} from "@/db/schema";
import {
  grantRoleMembership,
  hasIntegrationDatabase,
  resetAndMigrate,
  runAsRole,
} from "@/db/test-utils";
import { createAgentRun, markAgentRunStarted } from "@/lib/agents/agent-runs";
import { readAgentConfig } from "@/lib/agents/config";
import { executionIdentityForPersistedProvider } from "@/lib/agents/execution-identity";
import { AGENT_TOOLS } from "@/lib/agents/tools/menu-tools";
import {
  defineAgentTool,
  invokeAgentTool,
  type AgentTool,
  type AgentToolResult,
} from "@/lib/agents/tools/tool-gateway";
import {
  approveTenantAgentBinding,
  getTenantAgentBinding,
  setTenantAgentBindingEnabled,
} from "@/lib/agents/tenant-agent-bindings";
import { loadMenuSnapshotForAgent } from "@/lib/catalogue/menu-snapshot";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { createDraftProduct } from "@/lib/catalogue/products";
import { requireActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const ENABLED = readAgentConfig({ AGENTS_ENABLED: "true", AGENT_MENU_MANAGER_ENABLED: "true" });
const AGENT_ID = "cmun4w730017807adjrkbep1t";
const ADMIN = "admin.quotes@test";
const REQUESTER = "user.quotes@test";
const LATTE_NAME = "Secret Latte Name";
const MENU_TOOLS = { "menu.get_health": "menu.get_health.v1", "menu.get_items": "menu.get_items.v1" };

const badOutputTool = defineAgentTool({
  name: "test.bad_output",
  version: "test.bad_output.v1",
  risk: "read_only",
  dataSource: "current",
  timeoutMs: 1_000,
  input: z.strictObject({}),
  output: z.strictObject({ ok: z.literal(true) }),
  async execute() {
    return {
      output: { ok: false } as unknown as { ok: true },
      evidence: { menuVersion: null, acceptedMenuVersion: null, asOf: new Date(0).toISOString(), snapshotSha256: null },
    };
  },
});
const slowTool = defineAgentTool({
  name: "test.slow",
  version: "test.slow.v1",
  risk: "read_only",
  dataSource: "current",
  timeoutMs: 50,
  input: z.strictObject({}),
  output: z.strictObject({}),
  execute: () => new Promise(() => undefined),
});
const TEST_REGISTRY: ReadonlyMap<string, AgentTool> = new Map([
  ...AGENT_TOOLS,
  [badOutputTool.name, badOutputTool],
  [slowTool.name, slowTool],
]);

/**
 * PR 3: one tool gateway. Every call rebuilds the trusted execution context
 * from the persisted run and live state; accepted scope bounds what any tool
 * can read; only pinned tools at their pinned version run; every call is
 * audited without its payloads. All calls run as the restricted app role.
 */
integrationDescribe("agent tool gateway", () => {
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
    await sqlClient`TRUNCATE TABLE qos.agent_runs, qos.tenant_agent_bindings, qos.agent_provider_credentials, qos.agent_provider_connections, qos.tenant_audit_events, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedMember(tenantId: string, subject: string, role: "administrator" | "user", locationIds: string[]) {
    const [identity] = await db.insert(staffIdentities).values({ providerSubject: subject, email: subject }).returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity!.id, role })
      .returning();
    for (const locationId of locationIds) {
      await db.insert(staffLocationScopes).values({ tenantId, staffMembershipId: membership!.id, locationId });
    }
    return { membershipId: membership!.id, role, staffIdentityId: identity!.id };
  }

  /** A running run requested by a location-scoped user, accepted for the latte only. */
  async function seedRunningRun(tools: Record<string, string> = MENU_TOOLS) {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const tenantId = quotes.tenant.id;
    const admin = await seedMember(tenantId, ADMIN, "administrator", [quotes.location.id]);
    const requester = await seedMember(tenantId, REQUESTER, "user", [quotes.location.id]);
    const product = (name: string, internalName: string) =>
      createDraftProduct(db, tenantId, admin, {
        internalName,
        translations: { en: { displayName: name, description: "d" }, ar: { displayName: "x", description: "y" } },
        defaultVariant: { amountMinor: 1800, currency: "AED" },
      });
    const latte = await product(LATTE_NAME, "latte");
    const mocha = await product("Mocha", "mocha");
    const menu = await createDraftMenu(db, tenantId, admin, {
      internalName: "breakfast",
      locationIds: [quotes.location.id],
      translations: { en: { displayName: "Breakfast" }, ar: { displayName: "f" } },
      sections: [
        {
          internalName: "coffee",
          sortOrder: 0,
          translations: { en: { displayName: "Coffee" }, ar: { displayName: "q" } },
          products: [
            { productPublicId: latte.publicId, sortOrder: 0 },
            { productPublicId: mocha.publicId, sortOrder: 1 },
          ],
        },
      ],
    });
    const approved = await approveTenantAgentBinding(db, {
      tenantId,
      capability: "menu_manager",
      provider: "hyperagent",
      providerAgentId: AGENT_ID,
      approvedBySubject: "operator:platform",
    });
    await setTenantAgentBindingEnabled(db, tenantId, ADMIN, "menu_manager", {
      enabled: true,
      expectedVersion: approved.version,
    });
    const binding = (await withTenantContext(db, tenantId, (tx) => getTenantAgentBinding(tx, tenantId, "menu_manager")))!;
    const membership = await requireActiveStaffMembership(db, tenantId, REQUESTER);
    const built = await loadMenuSnapshotForAgent(db, tenantId, membership, menu.publicId, {
      selectedProductPublicIds: [latte.publicId],
    });
    const { run } = await createAgentRun(db, {
      tenantId,
      binding,
      subject: { type: "menu", publicId: menu.publicId, version: menu.version },
      requestedBy: { subject: REQUESTER, actorClass: "staff_user" },
      idempotencyKey: `idem-${randomBytes(6).toString("hex")}`,
      requestSummary: { snapshotSha256: built.sha256, productPublicIds: built.productPublicIds },
      pin: {
        definition: { key: "menu_manager", version: "test.tools.v1" },
        executionIdentity: executionIdentityForPersistedProvider("hyperagent"),
        runConfig: {
          schema: "qos.agent_run_config.v1",
          runTimeoutMs: ENABLED.runTimeoutMs,
          pollIntervalMs: ENABLED.pollIntervalMs,
          pollLeaseMs: ENABLED.pollLeaseMs,
          queuedStaleMs: ENABLED.queuedStaleMs,
          outputSchema: "test.output.v1",
          allowedTools: Object.keys(tools),
          toolSchemaVersions: tools,
        },
        input: { schema: built.snapshot.schema, payload: JSON.stringify(built.snapshot) },
      },
    });
    await markAgentRunStarted(db, tenantId, run.publicId, {
      providerThreadId: "thread_tools",
      actor: { subject: REQUESTER, actorClass: "staff_user" },
      pollIntervalMs: ENABLED.pollIntervalMs,
    });
    return { tenantId, quotes, menu, latte, mocha, requester, run, built };
  }

  function call(
    tenantId: string,
    runPublicId: string,
    tool: string,
    input: unknown = {},
    config = ENABLED,
  ): Promise<AgentToolResult> {
    return runAsRole(sqlClient, "qos_app", () =>
      invokeAgentTool(db, { tenantId, runPublicId, tool, input }, { config, registry: TEST_REGISTRY }),
    );
  }

  async function toolAudit(tenantId: string, runPublicId: string) {
    return withTenantContext(db, tenantId, (tx) =>
      tx
        .select({ changeSummary: tenantAuditEvents.changeSummary, actorClass: tenantAuditEvents.actorClass })
        .from(tenantAuditEvents)
        .where(
          and(
            eq(tenantAuditEvents.tenantId, tenantId),
            eq(tenantAuditEvents.entityPublicId, runPublicId),
            eq(tenantAuditEvents.action, "agent_tool.invoked"),
          ),
        )
        .orderBy(tenantAuditEvents.occurredAt),
    );
  }

  it("reads current health for accepted products only, with freshness evidence", async () => {
    const { tenantId, menu, latte, mocha, run } = await seedRunningRun();

    const result = await call(tenantId, run.publicId, "menu.get_health");

    expect(result).toMatchObject({
      ok: true,
      tool: "menu.get_health",
      version: "menu.get_health.v1",
      evidence: { dataSource: "current", menuVersion: menu.version, acceptedMenuVersion: menu.version, snapshotSha256: null },
    });
    const output = (result as Extract<AgentToolResult, { ok: true }>).output as {
      products: Array<{ productPublicId: string }>;
      productsNoLongerOnMenu: string[];
    };
    expect(output.products.map((product) => product.productPublicId)).toEqual([latte.publicId]);
    expect(JSON.stringify(output)).not.toContain(mocha.publicId);
    expect(output.productsNoLongerOnMenu).toEqual([]);
  });

  it("reads accepted products from the verified snapshot and refuses anything outside it", async () => {
    const { tenantId, latte, mocha, run, built } = await seedRunningRun();

    const items = await call(tenantId, run.publicId, "menu.get_items", { productPublicIds: [latte.publicId] });
    expect(items).toMatchObject({
      ok: true,
      evidence: { dataSource: "accepted_snapshot", snapshotSha256: built.sha256 },
      output: { products: [expect.objectContaining({ productPublicId: latte.publicId })] },
    });

    await expect(
      call(tenantId, run.publicId, "menu.get_items", { productPublicIds: [mocha.publicId] }),
    ).resolves.toMatchObject({ ok: false, code: "out_of_scope" });

    await sqlClient`ALTER TABLE qos.agent_run_inputs DISABLE TRIGGER agent_run_inputs_immutable`;
    try {
      await db.update(agentRunInputs).set({ payload: '{"tampered":true}' });
    } finally {
      await sqlClient`ALTER TABLE qos.agent_run_inputs ENABLE TRIGGER agent_run_inputs_immutable`;
    }
    await expect(
      call(tenantId, run.publicId, "menu.get_items", { productPublicIds: [latte.publicId] }),
    ).resolves.toMatchObject({ ok: false, code: "input_unavailable" });
  });

  it("runs only tools pinned on the run, at their pinned version, with valid input", async () => {
    const pinnedNothing = await seedRunningRun({});
    await expect(call(pinnedNothing.tenantId, pinnedNothing.run.publicId, "menu.get_health")).resolves.toMatchObject({
      ok: false,
      code: "tool_not_allowed",
    });
  });

  it("refuses unknown tools, other pinned versions and invalid input", async () => {
    const { tenantId, run } = await seedRunningRun({ ...MENU_TOOLS, "menu.get_health": "menu.get_health.v0" });

    await expect(call(tenantId, run.publicId, "menu.get_health")).resolves.toMatchObject({
      ok: false,
      code: "tool_version_unavailable",
    });
    await expect(call(tenantId, run.publicId, "sql.query")).resolves.toMatchObject({ ok: false, code: "unknown_tool" });
    await expect(
      call(tenantId, run.publicId, "menu.get_items", { productPublicIds: ["prd_x"], tenantId: "other" }),
    ).resolves.toMatchObject({ ok: false, code: "invalid_input" });
    await expect(
      call(tenantId, run.publicId, "menu.get_items", { productPublicIds: ["x".repeat(20_000)] }),
    ).resolves.toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("never returns unvalidated output and bounds execution time", async () => {
    const { tenantId, run } = await seedRunningRun({
      "test.bad_output": "test.bad_output.v1",
      "test.slow": "test.slow.v1",
    });

    await expect(call(tenantId, run.publicId, "test.bad_output")).resolves.toEqual({
      ok: false,
      tool: "test.bad_output",
      code: "invalid_output",
      message: expect.any(String),
    });
    await expect(call(tenantId, run.publicId, "test.slow")).resolves.toMatchObject({ ok: false, code: "tool_timeout" });
  });

  it("rechecks live state on every call", async () => {
    const { tenantId, quotes, requester, run, latte } = await seedRunningRun();
    const items = { productPublicIds: [latte.publicId] };
    await expect(call(tenantId, run.publicId, "menu.get_items", items)).resolves.toMatchObject({ ok: true });

    await expect(
      call(tenantId, run.publicId, "menu.get_items", items, { ...ENABLED, menuManagerEnabled: false }),
    ).resolves.toMatchObject({ ok: false, code: "capability_unavailable" });

    await db.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, tenantId));
    await expect(call(tenantId, run.publicId, "menu.get_items", items)).resolves.toMatchObject({
      ok: false,
      code: "tenant_inactive",
    });
    await db.update(tenants).set({ status: "active" }).where(eq(tenants.id, tenantId));

    await db
      .delete(staffLocationScopes)
      .where(
        and(
          eq(staffLocationScopes.staffMembershipId, requester.membershipId),
          eq(staffLocationScopes.locationId, quotes.location.id),
        ),
      );
    await expect(call(tenantId, run.publicId, "menu.get_items", items)).resolves.toMatchObject({
      ok: false,
      code: "requester_access_revoked",
    });
    await db
      .insert(staffLocationScopes)
      .values({ tenantId, staffMembershipId: requester.membershipId, locationId: quotes.location.id });

    await db.update(staffMemberships).set({ status: "revoked" }).where(eq(staffMemberships.id, requester.membershipId));
    await expect(call(tenantId, run.publicId, "menu.get_items", items)).resolves.toMatchObject({
      ok: false,
      code: "requester_access_revoked",
    });
    await db.update(staffMemberships).set({ status: "active" }).where(eq(staffMemberships.id, requester.membershipId));

    const binding = (await withTenantContext(db, tenantId, (tx) => getTenantAgentBinding(tx, tenantId, "menu_manager")))!;
    await setTenantAgentBindingEnabled(db, tenantId, ADMIN, "menu_manager", {
      enabled: false,
      expectedVersion: binding.version,
    });
    await expect(call(tenantId, run.publicId, "menu.get_items", items)).resolves.toMatchObject({
      ok: false,
      code: "binding_changed",
    });
  });

  it("does not let a later role grant widen the accepted scope", async () => {
    const { tenantId, requester, run, mocha } = await seedRunningRun();
    await db.update(staffMemberships).set({ role: "administrator" }).where(eq(staffMemberships.id, requester.membershipId));

    await expect(
      call(tenantId, run.publicId, "menu.get_items", { productPublicIds: [mocha.publicId] }),
    ).resolves.toMatchObject({ ok: false, code: "out_of_scope" });
    const health = await call(tenantId, run.publicId, "menu.get_health");
    expect(JSON.stringify(health)).not.toContain(mocha.publicId);
  });

  it("only serves running runs and keeps tenants apart", async () => {
    const { tenantId, run, latte } = await seedRunningRun();
    const other = await createTenantHierarchy(db, flowerTenantFixture());
    await expect(
      call(other.tenant.id, run.publicId, "menu.get_items", { productPublicIds: [latte.publicId] }),
    ).rejects.toMatchObject({ code: "run_not_found" });

    await sqlClient`UPDATE qos.agent_runs SET status = 'completed', finished_at = now(), next_poll_at = null WHERE public_id = ${run.publicId}`;
    await expect(
      call(tenantId, run.publicId, "menu.get_items", { productPublicIds: [latte.publicId] }),
    ).resolves.toMatchObject({ ok: false, code: "run_not_active" });
  });

  it("audits every call, allowed or refused, without payloads", async () => {
    const { tenantId, run, latte, mocha, menu } = await seedRunningRun();
    await call(tenantId, run.publicId, "menu.get_items", { productPublicIds: [latte.publicId] });
    await call(tenantId, run.publicId, "menu.get_items", { productPublicIds: [mocha.publicId] });
    await call(tenantId, run.publicId, "menu.get_health");

    const audit = await toolAudit(tenantId, run.publicId);
    expect(audit.map((event) => event.changeSummary)).toEqual([
      expect.objectContaining({ tool: "menu.get_items", version: "menu.get_items.v1", dataSource: "accepted_snapshot", outcome: "ok", menuVersion: menu.version }),
      expect.objectContaining({ tool: "menu.get_items", outcome: "out_of_scope" }),
      expect.objectContaining({ tool: "menu.get_health", dataSource: "current", outcome: "ok" }),
    ]);
    expect(audit.every((event) => event.actorClass === "system")).toBe(true);
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain(LATTE_NAME);
    expect(serialized).not.toContain(latte.publicId);
  });
});
