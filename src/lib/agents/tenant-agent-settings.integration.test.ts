import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { staffIdentities, staffMemberships } from "@/db/schema";
import {
  grantRoleMembership,
  hasIntegrationDatabase,
  resetAndMigrate,
  runAsRole,
} from "@/db/test-utils";
import { readAgentConfig } from "@/lib/agents/config";
import { parseAgentCredentialKey } from "@/lib/agents/credential-crypto";
import { saveAgentProviderConnection } from "@/lib/agents/provider-connections";
import {
  approveTenantAgentBinding,
  setTenantAgentBindingEnabled,
} from "@/lib/agents/tenant-agent-bindings";
import { getTenantAgentSettings } from "@/lib/agents/tenant-agent-settings";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const AGENT_ID = "cmun4w730017807adjrkbep1t";
const SERVER_URL = "https://hyperagent.example/api/mcp";
const ENABLED = readAgentConfig({
  AGENTS_ENABLED: "true",
  AGENT_MENU_MANAGER_ENABLED: "true",
  AGENT_MENU_MANAGER_EXECUTOR: "hyperagent",
});

integrationDescribe("tenant agent settings", () => {
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
    await sqlClient`TRUNCATE TABLE qos.tenant_agent_bindings, qos.agent_provider_credentials, qos.agent_provider_connections, qos.tenant_audit_events, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedMember(tenantId: string, role: "administrator" | "user", subject: string) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: subject, email: subject })
      .returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity.id, role })
      .returning();
    return { membershipId: membership.id, role, staffIdentityId: identity.id };
  }

  it("walks through each unavailable reason and never exposes connection or agent details", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const tenantId = quotes.tenant.id;
    const admin = await seedMember(tenantId, "administrator", "admin@test");
    const staff = await seedMember(tenantId, "user", "staff@test");
    const read = (membership: typeof admin, config = ENABLED) =>
      runAsRole(sqlClient, "qos_app", () => getTenantAgentSettings(db, tenantId, membership, { config }));

    await expect(read(admin, readAgentConfig({}))).resolves.toMatchObject({
      canManage: true,
      menuManager: { available: false, unavailableReason: "feature_off" },
    });
    await expect(read(staff)).resolves.toMatchObject({
      canManage: false,
      connection: { status: "disconnected" },
      menuManager: { unavailableReason: "not_configured", binding: null },
    });

    const binding = await approveTenantAgentBinding(db, {
      tenantId,
      capability: "menu_manager",
      provider: "hyperagent",
      providerAgentId: AGENT_ID,
      approvedBySubject: "operator:platform",
    });
    await expect(read(admin)).resolves.toMatchObject({
      menuManager: { unavailableReason: "disabled", binding: { enabled: false } },
    });

    await expect(
      setTenantAgentBindingEnabled(db, tenantId, "staff@test", "menu_manager", {
        enabled: true,
        expectedVersion: binding.version,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    await setTenantAgentBindingEnabled(db, tenantId, "admin@test", "menu_manager", {
      enabled: true,
      expectedVersion: binding.version,
    });
    await expect(read(admin)).resolves.toMatchObject({
      menuManager: { unavailableReason: "not_connected", binding: { enabled: true } },
    });

    await saveAgentProviderConnection(db, {
      provider: "hyperagent",
      serverUrl: SERVER_URL,
      accountLabel: "platform@qos",
      connectedBySubject: "operator:test",
      credentialKey: parseAgentCredentialKey(randomBytes(32).toString("base64")),
      credentials: { tokens: { access_token: "secret-access-token" } },
    });
    const ready = await read(staff);
    expect(ready).toMatchObject({
      canManage: false,
      connection: { status: "connected" },
      menuManager: { available: true, unavailableReason: null },
    });

    const serialized = JSON.stringify(ready);
    for (const hidden of [SERVER_URL, "platform@qos", "operator:test", "secret-access-token", AGENT_ID, tenantId]) {
      expect(serialized).not.toContain(hidden);
    }
  });
});
