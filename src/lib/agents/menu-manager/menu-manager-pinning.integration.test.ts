import { createHash, randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  agentRunInputs,
  agentRuns,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
  tenantAuditEvents,
} from "@/db/schema";
import {
  grantRoleMembership,
  hasIntegrationDatabase,
  resetAndMigrate,
  runAsRole,
} from "@/db/test-utils";
import * as agentRunsModule from "@/lib/agents/agent-runs";
import {
  AgentRunError,
  createAgentRun,
  loadPinnedRunInput,
  MAX_RUN_INPUT_BYTES,
} from "@/lib/agents/agent-runs";
import { readAgentConfig } from "@/lib/agents/config";
import { parseAgentCredentialKey } from "@/lib/agents/credential-crypto";
import { executionIdentityForPersistedProvider } from "@/lib/agents/execution-identity";
import * as definitions from "@/lib/agents/menu-manager/menu-manager-definition";
import { CURRENT_MENU_MANAGER_DEFINITION } from "@/lib/agents/menu-manager/menu-manager-definition";
import {
  askMenuManager,
  refreshMenuManagerRun,
} from "@/lib/agents/menu-manager/menu-manager-service";
import * as connections from "@/lib/agents/provider-connections";
import {
  approveTenantAgentBinding,
  getTenantAgentBinding,
  setTenantAgentBindingEnabled,
} from "@/lib/agents/tenant-agent-bindings";
import { FakeAgentProvider } from "@/lib/agents/testing/fake-agent-provider";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { createDraftProduct } from "@/lib/catalogue/products";
import type { MenuSnapshot } from "@/lib/catalogue/menu-snapshot";
import { requireActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

vi.mock("@/lib/agents/agent-runs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agents/agent-runs")>();
  return { ...actual, loadPinnedRunInput: vi.fn(actual.loadPinnedRunInput) };
});
vi.mock("@/lib/agents/menu-manager/menu-manager-definition", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agents/menu-manager/menu-manager-definition")>();
  return { ...actual, getMenuManagerDefinition: vi.fn(actual.getMenuManagerDefinition) };
});

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const ENABLED = readAgentConfig({
  AGENTS_ENABLED: "true",
  AGENT_MENU_MANAGER_ENABLED: "true",
  AGENT_MENU_MANAGER_EXECUTOR: "hyperagent",
});
const AGENT_ID = "cmun4w730017807adjrkbep1t";
const ADMIN = "admin.quotes@test";
const PRODUCT_NAME = "Pinned Latte Name";
const pollDue = () => new Date(Date.now() + ENABLED.pollIntervalMs + 1);

/** A provider of the same kind whose adapter has moved on since the run was pinned. */
function driftedProvider() {
  const provider = new FakeAgentProvider();
  Object.defineProperty(provider, "identity", {
    value: { ...provider.identity, adapterVersion: "hyperagent-mcp.v2" },
  });
  return provider;
}

/**
 * PR 2b: each run pins its definition, executor identity, operational config
 * and exact bounded input. Dispatch and reply interpretation use the pins,
 * never newer code or live data; anything unverifiable is refused, not guessed.
 */
integrationDescribe("Menu Manager run pinning", () => {
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
    vi.clearAllMocks();
    await sqlClient`TRUNCATE TABLE qos.agent_runs, qos.tenant_agent_bindings, qos.agent_provider_credentials, qos.agent_provider_connections, qos.tenant_audit_events, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seed() {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const tenantId = quotes.tenant.id;
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: ADMIN, email: ADMIN })
      .returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity!.id, role: "administrator" })
      .returning();
    await db
      .insert(staffLocationScopes)
      .values({ tenantId, staffMembershipId: membership!.id, locationId: quotes.location.id });
    const admin = { membershipId: membership!.id, role: "administrator" as const, staffIdentityId: identity!.id };
    const product = await createDraftProduct(db, tenantId, admin, {
      internalName: "latte",
      translations: { en: { displayName: PRODUCT_NAME, description: "d" }, ar: { displayName: "lt", description: "w" } },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    });
    const menu = await createDraftMenu(db, tenantId, admin, {
      internalName: "breakfast",
      locationIds: [quotes.location.id],
      translations: { en: { displayName: "Breakfast" }, ar: { displayName: "ft" } },
      sections: [
        {
          internalName: "coffee",
          sortOrder: 0,
          translations: { en: { displayName: "Coffee" }, ar: { displayName: "qh" } },
          products: [{ productPublicId: product.publicId, sortOrder: 0 }],
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
    await connections.saveAgentProviderConnection(db, {
      provider: "hyperagent",
      serverUrl: "https://hyperagent.example/api/mcp",
      connectedBySubject: "operator:test",
      credentialKey: parseAgentCredentialKey(randomBytes(32).toString("base64")),
      credentials: { tokens: { access_token: "never-read" } },
    });
    const binding = (await withTenantContext(db, tenantId, (tx) =>
      getTenantAgentBinding(tx, tenantId, "menu_manager"),
    ))!;
    return { tenantId, menu, product, binding };
  }

  async function callerFor(tenantId: string) {
    const membership = await runAsRole(sqlClient, "qos_app", () =>
      requireActiveStaffMembership(db, tenantId, ADMIN),
    );
    return { tenantId, subject: ADMIN, membership };
  }

  async function ask(tenantId: string, menuPublicId: string, provider: FakeAgentProvider) {
    const caller = await callerFor(tenantId);
    return runAsRole(sqlClient, "qos_app", () =>
      askMenuManager(
        db,
        caller,
        { menuPublicId, idempotencyKey: `idem-${randomBytes(6).toString("hex")}` },
        { config: ENABLED, provider },
      ),
    );
  }

  async function refresh(
    tenantId: string,
    menuPublicId: string,
    runPublicId: string,
    provider: FakeAgentProvider,
    config = ENABLED,
  ) {
    const caller = await callerFor(tenantId);
    return runAsRole(sqlClient, "qos_app", () =>
      refreshMenuManagerRun(db, caller, { menuPublicId, runPublicId }, { config, provider, now: pollDue }),
    );
  }

  async function auditFor(tenantId: string, runPublicId: string) {
    return withTenantContext(db, tenantId, (tx) =>
      tx
        .select({ action: tenantAuditEvents.action, changeSummary: tenantAuditEvents.changeSummary })
        .from(tenantAuditEvents)
        .where(and(eq(tenantAuditEvents.tenantId, tenantId), eq(tenantAuditEvents.entityPublicId, runPublicId)))
        .orderBy(tenantAuditEvents.occurredAt),
    );
  }

  function validReply(menuPublicId: string) {
    return JSON.stringify({
      schema: "qos.menu_manager_result.v1",
      menuPublicId,
      summary: "Looks fine.",
      findings: [],
      suggestions: [],
    });
  }

  it("pins definition, executor, config and the exact input, and sends the request built from them", async () => {
    const { tenantId, menu } = await seed();
    const provider = new FakeAgentProvider();

    const { run } = await ask(tenantId, menu.publicId, provider);
    expect(run.status).toBe("running");

    const [row] = await db.select().from(agentRuns);
    expect(row).toMatchObject({
      definitionKey: "menu_manager",
      definitionVersion: "menu_manager.v1",
      executionIdentity: executionIdentityForPersistedProvider("hyperagent"),
      runConfig: {
        schema: "qos.agent_run_config.v1",
        runTimeoutMs: ENABLED.runTimeoutMs,
        pollIntervalMs: ENABLED.pollIntervalMs,
        pollLeaseMs: ENABLED.pollLeaseMs,
        queuedStaleMs: ENABLED.queuedStaleMs,
        outputSchema: "qos.menu_manager_result.v1",
        allowedTools: [],
        toolSchemaVersions: {},
      },
    });
    expect(row!.deadlineAt.getTime() - row!.createdAt.getTime()).toBe(ENABLED.runTimeoutMs);
    expect(run).not.toHaveProperty("runConfig");
    expect(run).not.toHaveProperty("executionIdentity");

    const [input] = await db.select().from(agentRunInputs);
    expect(input).toMatchObject({ runId: row!.id, tenantId, inputSchema: "qos.menu_snapshot.v1" });
    expect(input!.payloadSha256).toBe(createHash("sha256").update(input!.payload).digest("hex"));
    expect(input!.payloadSha256).toBe(row!.requestSummary.snapshotSha256);
    expect(input!.payload).toContain(PRODUCT_NAME);
    expect(provider.startCalls).toHaveLength(1);
    expect(provider.startCalls[0]!.message).toBe(
      CURRENT_MENU_MANAGER_DEFINITION.buildRequest(JSON.parse(input!.payload) as MenuSnapshot),
    );

    const audit = await auditFor(tenantId, run.publicId);
    expect(audit[0]).toMatchObject({
      action: "agent_run.requested",
      changeSummary: expect.objectContaining({
        definitionVersion: "menu_manager.v1",
        adapterVersion: "hyperagent-mcp.v1",
        input: { schema: "qos.menu_snapshot.v1", sha256: input!.payloadSha256 },
      }),
    });
    const serializedAudit = JSON.stringify(audit);
    expect(serializedAudit).not.toContain(PRODUCT_NAME);
    expect(serializedAudit).not.toContain('"products"');
  });

  it("keeps the pinned input and request summary immutable for the application role", async () => {
    const { tenantId, menu } = await seed();
    const { run } = await ask(tenantId, menu.publicId, new FakeAgentProvider());

    await runAsRole(sqlClient, "qos_app", async () => {
      await expect(
        withTenantContext(db, tenantId, (tx) => tx.update(agentRunInputs).set({ payload: "{}" })),
      ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "42501" }) });
      await expect(
        withTenantContext(db, tenantId, (tx) => tx.delete(agentRunInputs)),
      ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "42501" }) });
      await expect(
        withTenantContext(db, tenantId, (tx) =>
          tx.update(agentRuns).set({ definitionVersion: "menu_manager.v2" }).where(eq(agentRuns.publicId, run.publicId)),
        ),
      ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "42501" }) });
    });
  });

  it("refuses an input whose checksum no longer matches", async () => {
    const { tenantId, binding } = await seed();
    const created = await createAgentRun(db, {
      tenantId,
      binding,
      subject: { type: "menu", publicId: "men_other", version: 1 },
      requestedBy: { subject: ADMIN, actorClass: "staff_administrator" },
      idempotencyKey: "idem-tamper-0001",
      requestSummary: {},
      pin: {
        definition: { key: "menu_manager", version: "menu_manager.v1" },
        executionIdentity: executionIdentityForPersistedProvider("hyperagent"),
        runConfig: {
          schema: "qos.agent_run_config.v1",
          runTimeoutMs: ENABLED.runTimeoutMs,
          pollIntervalMs: ENABLED.pollIntervalMs,
          pollLeaseMs: ENABLED.pollLeaseMs,
          queuedStaleMs: ENABLED.queuedStaleMs,
          outputSchema: "qos.menu_manager_result.v1",
          allowedTools: [],
          toolSchemaVersions: {},
        },
        input: { schema: "qos.menu_snapshot.v1", payload: '{"a":1}' },
      },
    });
    await expect(loadPinnedRunInput(db, tenantId, created.run.id)).resolves.toMatchObject({ ok: true });

    await sqlClient`ALTER TABLE qos.agent_run_inputs DISABLE TRIGGER agent_run_inputs_immutable`;
    try {
      await sqlClient`UPDATE qos.agent_run_inputs SET payload = '{"a":2}' WHERE run_id = ${created.run.id}`;
    } finally {
      await sqlClient`ALTER TABLE qos.agent_run_inputs ENABLE TRIGGER agent_run_inputs_immutable`;
    }
    await expect(loadPinnedRunInput(db, tenantId, created.run.id)).resolves.toEqual({
      ok: false,
      reason: "checksum_mismatch",
    });
  });

  it("does not send a review whose pinned input cannot be verified", async () => {
    const { tenantId, menu } = await seed();
    const provider = new FakeAgentProvider();
    vi.mocked(agentRunsModule.loadPinnedRunInput).mockResolvedValueOnce({ ok: false, reason: "checksum_mismatch" });

    const { run } = await ask(tenantId, menu.publicId, provider);

    expect(run).toMatchObject({ status: "failed", failureCode: "pinned_input_invalid", remoteOutcomeUnknown: false });
    expect(provider.startCalls).toHaveLength(0);
  });

  it("does not send a review pinned to a definition this build does not have", async () => {
    const { tenantId, menu } = await seed();
    const provider = new FakeAgentProvider();
    vi.mocked(definitions.getMenuManagerDefinition).mockReturnValueOnce(null);

    const { run } = await ask(tenantId, menu.publicId, provider);

    expect(run).toMatchObject({ status: "failed", failureCode: "definition_unavailable", remoteOutcomeUnknown: false });
    expect(provider.startCalls).toHaveLength(0);
  });

  it("does not read a reply with a definition other than the pinned one", async () => {
    const { tenantId, menu } = await seed();
    const provider = new FakeAgentProvider();
    const { run } = await ask(tenantId, menu.publicId, provider);
    provider.script({ state: "completed", finalMessage: validReply(menu.publicId) });
    vi.mocked(definitions.getMenuManagerDefinition).mockReturnValueOnce(null);

    await expect(refresh(tenantId, menu.publicId, run.publicId, provider)).resolves.toMatchObject({
      status: "running",
      waitingOn: "service_unavailable",
    });
    expect(provider.getRunCalls).toHaveLength(0);

    await expect(refresh(tenantId, menu.publicId, run.publicId, provider)).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("does not send or poll through an executor whose identity differs from the pin", async () => {
    const { tenantId, menu } = await seed();

    const drifted = driftedProvider();
    const { run: refused } = await ask(tenantId, menu.publicId, drifted);
    expect(refused).toMatchObject({ status: "failed", failureCode: "executor_mismatch", remoteOutcomeUnknown: false });
    expect(drifted.startCalls).toHaveLength(0);

    const { run } = await ask(tenantId, menu.publicId, new FakeAgentProvider());
    expect(run.status).toBe("running");
    const pollDrifted = driftedProvider();
    await expect(refresh(tenantId, menu.publicId, run.publicId, pollDrifted)).resolves.toMatchObject({
      status: "running",
      waitingOn: "service_unavailable",
    });
    expect(pollDrifted.getRunCalls).toHaveLength(0);
  });

  it("keeps a Hyperagent run on Hyperagent after the process default becomes native", async () => {
    const { tenantId, menu } = await seed();
    const provider = new FakeAgentProvider();
    const { run } = await ask(tenantId, menu.publicId, provider);
    expect(run.status).toBe("running");

    const nativeDefault = readAgentConfig({
      AGENTS_ENABLED: "true",
      AGENT_MENU_MANAGER_ENABLED: "true",
    });
    expect(nativeDefault.menuManagerExecutor).toBe("native");
    provider.script({ state: "completed", finalMessage: validReply(menu.publicId) });

    await expect(refresh(tenantId, menu.publicId, run.publicId, provider, nativeDefault)).resolves.toMatchObject({
      status: "completed",
    });
    const [row] = await db.select().from(agentRuns);
    expect(row).toMatchObject({
      provider: "hyperagent",
      executionIdentity: executionIdentityForPersistedProvider("hyperagent"),
    });
    expect(provider.getRunCalls).toHaveLength(1);
  });

  it("polls on the pinned schedule after the configuration changes", async () => {
    const { tenantId, menu } = await seed();
    const provider = new FakeAgentProvider();
    const { run } = await ask(tenantId, menu.publicId, provider);

    const changed = { ...ENABLED, pollIntervalMs: 3_600_000 };
    await refresh(tenantId, menu.publicId, run.publicId, provider, changed);

    const [row] = await db.select().from(agentRuns);
    expect(provider.getRunCalls).toHaveLength(1);
    const scheduledAfter = row!.nextPollAt!.getTime() - row!.lastPolledAt!.getTime();
    expect(scheduledAfter).toBeGreaterThanOrEqual(ENABLED.pollIntervalMs);
    expect(scheduledAfter).toBeLessThan(ENABLED.pollIntervalMs + 60_000);
  });

  it("reads runs created before pinning with v1 and the current configuration", async () => {
    const { tenantId, menu, binding } = await seed();
    const now = new Date();
    const [legacy] = await db
      .insert(agentRuns)
      .values({
        tenantId,
        publicId: "run_legacy",
        bindingId: binding.id,
        capability: "menu_manager",
        provider: "hyperagent",
        providerAgentId: AGENT_ID,
        providerThreadId: "thread_legacy",
        status: "running",
        subjectType: "menu",
        subjectPublicId: menu.publicId,
        subjectVersion: menu.version,
        requestedBySubject: ADMIN,
        requestedByActorClass: "staff_administrator",
        idempotencyKey: "idem-legacy-0001",
        correlationId: crypto.randomUUID(),
        requestSummary: { productPublicIds: [] },
        deadlineAt: new Date(now.getTime() + ENABLED.runTimeoutMs),
        startedAt: now,
        nextPollAt: now,
      })
      .returning();
    expect(legacy).toMatchObject({ definitionVersion: null, executionIdentity: null, runConfig: null });

    const provider = new FakeAgentProvider().script({ state: "completed", finalMessage: validReply(menu.publicId) });
    await expect(refresh(tenantId, menu.publicId, "run_legacy", provider)).resolves.toMatchObject({
      status: "completed",
      result: expect.objectContaining({ summary: "Looks fine." }),
    });
  });

  it("rejects an input larger than the pinned-input limit before writing anything", async () => {
    const { tenantId, binding } = await seed();
    await expect(
      createAgentRun(db, {
        tenantId,
        binding,
        subject: { type: "menu", publicId: "men_big", version: 1 },
        requestedBy: { subject: ADMIN, actorClass: "staff_administrator" },
        idempotencyKey: "idem-too-large-0001",
        requestSummary: {},
        pin: {
          definition: { key: "menu_manager", version: "menu_manager.v1" },
          executionIdentity: executionIdentityForPersistedProvider("hyperagent"),
          runConfig: {
            schema: "qos.agent_run_config.v1",
            runTimeoutMs: 1,
            pollIntervalMs: 1,
            pollLeaseMs: 1,
            queuedStaleMs: 1,
            outputSchema: "x",
            allowedTools: [],
            toolSchemaVersions: {},
          },
          input: { schema: "x", payload: "x".repeat(MAX_RUN_INPUT_BYTES + 1) },
        },
      }),
    ).rejects.toBeInstanceOf(AgentRunError);
    expect(await db.select().from(agentRuns)).toHaveLength(0);
    expect(await db.select().from(agentRunInputs)).toHaveLength(0);
  });
});
