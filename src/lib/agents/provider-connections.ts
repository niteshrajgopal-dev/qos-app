import { and, eq, sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { agentProviderConnections, agentProviderCredentials } from "@/db/schema";
import {
  decryptAgentCredential,
  encryptAgentCredential,
  type AgentCredentialKey,
} from "@/lib/agents/credential-crypto";
import { withAgentCredentialAccess, withAgentPlatformAdmin } from "@/lib/agents/db-context";
import type { AgentConnectionStatus, AgentProviderKind } from "@/lib/agents/types";

/** Non-secret connection facts, safe for tenant-facing status screens. */
export type AgentProviderConnectionStatusView = {
  provider: AgentProviderKind;
  status: AgentConnectionStatus;
  accountLabel: string | null;
  connectedAt: string | null;
  lastCheckedAt: string | null;
  lastErrorCode: string | null;
};

export type ProviderCredentials = Record<string, unknown>;

export class AgentProviderConnectionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AgentProviderConnectionError";
    this.code = code;
  }
}

function toIso(value: Date | null) {
  return value ? value.toISOString() : null;
}

export async function getAgentProviderConnectionStatus(
  db: DbClient,
  provider: AgentProviderKind,
): Promise<AgentProviderConnectionStatusView> {
  const [row] = await db
    .select({
      status: agentProviderConnections.status,
      accountLabel: agentProviderConnections.accountLabel,
      connectedAt: agentProviderConnections.connectedAt,
      lastCheckedAt: agentProviderConnections.lastCheckedAt,
      lastErrorCode: agentProviderConnections.lastErrorCode,
    })
    .from(agentProviderConnections)
    .where(eq(agentProviderConnections.provider, provider))
    .limit(1);

  if (!row) {
    return {
      provider,
      status: "disconnected",
      accountLabel: null,
      connectedAt: null,
      lastCheckedAt: null,
      lastErrorCode: null,
    };
  }

  return {
    provider,
    status: row.status,
    accountLabel: row.accountLabel,
    connectedAt: toIso(row.connectedAt),
    lastCheckedAt: toIso(row.lastCheckedAt),
    lastErrorCode: row.lastErrorCode,
  };
}

/** Operator-only: stores (or replaces) the platform connection and its secret. */
export async function saveAgentProviderConnection(
  db: DbClient,
  input: {
    provider: AgentProviderKind;
    serverUrl: string;
    accountLabel?: string | null;
    connectedBySubject: string;
    credentials: ProviderCredentials;
    credentialKey: AgentCredentialKey;
  },
) {
  const ciphertext = encryptAgentCredential(
    input.credentials,
    input.credentialKey,
    input.provider,
  );

  return withAgentPlatformAdmin(db, async (tx) => {
    const now = new Date();
    const [connection] = await tx
      .insert(agentProviderConnections)
      .values({
        provider: input.provider,
        status: "connected",
        serverUrl: input.serverUrl,
        accountLabel: input.accountLabel ?? null,
        connectedBySubject: input.connectedBySubject,
        connectedAt: now,
        lastCheckedAt: now,
      })
      .onConflictDoUpdate({
        target: agentProviderConnections.provider,
        set: {
          status: "connected",
          serverUrl: input.serverUrl,
          accountLabel: input.accountLabel ?? null,
          connectedBySubject: input.connectedBySubject,
          connectedAt: now,
          lastCheckedAt: now,
          lastErrorCode: null,
          lastErrorAt: null,
          updatedAt: now,
        },
      })
      .returning({ id: agentProviderConnections.id });

    await tx
      .insert(agentProviderCredentials)
      .values({
        connectionId: connection!.id,
        ciphertext,
        keyFingerprint: input.credentialKey.fingerprint,
      })
      .onConflictDoUpdate({
        target: agentProviderCredentials.connectionId,
        set: {
          ciphertext,
          keyFingerprint: input.credentialKey.fingerprint,
          version: sql`${agentProviderCredentials.version} + 1`,
          updatedAt: now,
        },
      });

    return { connectionId: connection!.id };
  });
}

export type LoadedProviderCredentials = {
  connectionId: string;
  serverUrl: string;
  version: number;
  credentials: ProviderCredentials;
};

export async function loadAgentProviderCredentials(
  db: DbClient,
  provider: AgentProviderKind,
  credentialKey: AgentCredentialKey,
): Promise<LoadedProviderCredentials> {
  const row = await withAgentCredentialAccess(db, async (tx) => {
    const [found] = await tx
      .select({
        connectionId: agentProviderConnections.id,
        status: agentProviderConnections.status,
        serverUrl: agentProviderConnections.serverUrl,
        ciphertext: agentProviderCredentials.ciphertext,
        version: agentProviderCredentials.version,
      })
      .from(agentProviderConnections)
      .innerJoin(
        agentProviderCredentials,
        eq(agentProviderCredentials.connectionId, agentProviderConnections.id),
      )
      .where(eq(agentProviderConnections.provider, provider))
      .limit(1);
    return found;
  });

  if (!row) {
    throw new AgentProviderConnectionError(
      "not_connected",
      `The platform ${provider} connection has not been set up.`,
    );
  }

  if (row.status !== "connected") {
    throw new AgentProviderConnectionError(
      row.status,
      `The platform ${provider} connection is ${row.status}.`,
    );
  }

  return {
    connectionId: row.connectionId,
    serverUrl: row.serverUrl,
    version: row.version,
    credentials: decryptAgentCredential<ProviderCredentials>(
      row.ciphertext,
      credentialKey,
      provider,
    ),
  };
}

/**
 * Replaces the stored secret (for example after a token refresh) only if no
 * other replica has replaced it since `expectedVersion`. Returns false when it
 * lost that race; the caller should reload.
 */
export async function replaceAgentProviderCredentials(
  db: DbClient,
  input: {
    connectionId: string;
    provider: AgentProviderKind;
    expectedVersion: number;
    credentials: ProviderCredentials;
    credentialKey: AgentCredentialKey;
  },
): Promise<boolean> {
  const ciphertext = encryptAgentCredential(
    input.credentials,
    input.credentialKey,
    input.provider,
  );

  const updated = await withAgentCredentialAccess(db, (tx) =>
    tx
      .update(agentProviderCredentials)
      .set({
        ciphertext,
        keyFingerprint: input.credentialKey.fingerprint,
        version: input.expectedVersion + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentProviderCredentials.connectionId, input.connectionId),
          eq(agentProviderCredentials.version, input.expectedVersion),
        ),
      )
      .returning({ id: agentProviderCredentials.id }),
  );

  return updated.length === 1;
}

export async function markAgentProviderConnectionStatus(
  db: DbClient,
  provider: AgentProviderKind,
  input: { status: AgentConnectionStatus; errorCode?: string | null },
) {
  const now = new Date();
  await withAgentCredentialAccess(db, (tx) =>
    tx
      .update(agentProviderConnections)
      .set({
        status: input.status,
        lastCheckedAt: now,
        lastErrorCode: input.errorCode?.slice(0, 100) ?? null,
        lastErrorAt: input.errorCode ? now : null,
        updatedAt: now,
      })
      .where(eq(agentProviderConnections.provider, provider)),
  );
}
