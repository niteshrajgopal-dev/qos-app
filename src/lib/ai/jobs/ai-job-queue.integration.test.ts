import { randomBytes, randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { aiJobAttempts, aiJobs } from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate, runAsRole } from "@/db/test-utils";
import { approveTenantAgentBinding } from "@/lib/agents/tenant-agent-bindings";
import {
  AiJobLeaseLostError,
  cancelUnclaimedAiJobInTx,
  claimNextAiJob,
  enqueueAiJobInTx,
  finishAiJobStep,
  heartbeatAiJob,
  markAiJobDispatched,
  type AiJobClaimLimits,
  type AiJobKind,
  type ClaimedAiJob,
} from "@/lib/ai/jobs/ai-job-queue";
import { withTenantContext } from "@/lib/tenant/context";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const KIND: AiJobKind = "menu_manager.run";
const OPEN: AiJobClaimLimits = { leaseMs: 60_000, maxActiveGlobal: 10, maxActivePerTenant: 10, maxActivePerKind: 10 };

/**
 * Queue mechanics behind the SECURITY DEFINER functions: caps hold, tenants
 * are served fairly, leases are fenced by token and database time, and the API
 * can only cancel its own tenant's never-claimed jobs.
 */
integrationDescribe("AI job queue", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];
  let tenants: { a: { id: string; bindingId: string }; b: { id: string; bindingId: string } };

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
    await grantRoleMembership(sqlClient, "qos", "qos_app");
    await grantRoleMembership(sqlClient, "qos", "qos_ai_worker");
    await grantRoleMembership(sqlClient, "qos", "qos_ai_scaler");
  }, 120_000);

  afterAll(async () => {
    await sqlClient.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.ai_job_attempts, qos.ai_jobs, qos.agent_run_inputs, qos.agent_runs, qos.tenant_agent_bindings, qos.tenant_audit_events, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
    const make = async (fixture: ReturnType<typeof quotesTenantFixture>) => {
      const hierarchy = await createTenantHierarchy(db, fixture);
      const binding = await approveTenantAgentBinding(db, {
        tenantId: hierarchy.tenant.id,
        capability: "menu_manager",
        provider: "hyperagent",
        providerAgentId: "cmun4w730017807adjrkbep1t",
        approvedBySubject: "operator:platform",
      });
      const [row] = await sqlClient`SELECT id FROM qos.tenant_agent_bindings WHERE public_id = ${binding.publicId}`;
      return { id: hierarchy.tenant.id, bindingId: row!.id as string };
    };
    tenants = { a: await make(quotesTenantFixture()), b: await make(flowerTenantFixture()) };
  });

  async function enqueue(tenant: { id: string; bindingId: string }, options: { at?: Date; kind?: string } = {}) {
    const runId = randomUUID();
    await sqlClient`
      INSERT INTO qos.agent_runs (id, tenant_id, public_id, binding_id, capability, provider, provider_agent_id,
        subject_type, subject_public_id, requested_by_subject, requested_by_actor_class, idempotency_key,
        correlation_id, request_summary, deadline_at, execution_mode)
      VALUES (${runId}::uuid, ${tenant.id}::uuid, ${`run_${randomBytes(12).toString("hex")}`}, ${tenant.bindingId}::uuid,
        'menu_manager', 'hyperagent', 'cmun4w730017807adjrkbep1t', 'menu', ${`men_${randomBytes(6).toString("hex")}`},
        'admin@test', 'staff_administrator',
        ${`idem-${randomBytes(6).toString("hex")}`}, ${randomUUID()}::uuid, '{}'::jsonb, now() + interval '1 hour',
        'queued_worker')`;
    if (options.kind) {
      const at = (options.at ?? new Date()).toISOString();
      const [row] = await sqlClient`
        INSERT INTO qos.ai_jobs (tenant_id, public_id, job_kind, agent_run_id, next_attempt_at, created_at, updated_at)
        VALUES (${tenant.id}::uuid, ${`job_${randomBytes(12).toString("hex")}`}, ${options.kind}, ${runId}::uuid, ${at}::timestamptz, ${at}::timestamptz, ${at}::timestamptz)
        RETURNING id, public_id`;
      return { id: row!.id as string, publicId: row!.public_id as string, agentRunId: runId };
    }
    return withTenantContext(db, tenant.id, (tx) =>
      enqueueAiJobInTx(tx, { tenantId: tenant.id, jobKind: KIND, agentRunId: runId, now: options.at }),
    );
  }

  function claim(limits: Partial<AiJobClaimLimits> = {}, kinds: string[] = [KIND]) {
    return runAsRole(sqlClient, "qos_ai_worker", () =>
      claimNextAiJob(db, { workerId: "w-test", jobKinds: kinds as AiJobKind[], limits: { ...OPEN, ...limits } }),
    );
  }

  function asWorker<T>(fn: () => Promise<T>) {
    return runAsRole(sqlClient, "qos_ai_worker", fn);
  }

  async function expireLease(job: ClaimedAiJob) {
    await sqlClient`UPDATE qos.ai_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = ${job.jobId}::uuid`;
  }

  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);

  it("holds the global cap and frees a slot when a step finishes", async () => {
    await enqueue(tenants.a, { at: ago(3) });
    await enqueue(tenants.b, { at: ago(2) });
    await enqueue(tenants.a, { at: ago(1) });

    const first = await claim({ maxActiveGlobal: 2 });
    const second = await claim({ maxActiveGlobal: 2 });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    await expect(claim({ maxActiveGlobal: 2 })).resolves.toBeNull();

    await asWorker(() => finishAiJobStep(db, first!, { type: "completed" }));
    await expect(claim({ maxActiveGlobal: 2 })).resolves.not.toBeNull();
  });

  it("holds the per-tenant and per-kind caps", async () => {
    await enqueue(tenants.a, { at: ago(3) });
    await enqueue(tenants.a, { at: ago(2) });
    await enqueue(tenants.b, { at: ago(1) });

    const first = await claim({ maxActivePerTenant: 1 });
    const second = await claim({ maxActivePerTenant: 1 });
    expect([first!.tenantId, second!.tenantId].sort()).toEqual([tenants.a.id, tenants.b.id].sort());
    await expect(claim({ maxActivePerTenant: 1 })).resolves.toBeNull();

    await enqueue(tenants.b, { at: ago(1), kind: "other.kind" });
    await expect(claim({ maxActivePerKind: 2 })).resolves.toBeNull();
    const other = await claim({ maxActivePerKind: 2 }, [KIND, "other.kind"]);
    expect(other).toMatchObject({ jobKind: "other.kind" });
  });

  it("serves the tenant claimed longest ago first, even behind an older backlog", async () => {
    await enqueue(tenants.a, { at: ago(10) });
    await enqueue(tenants.a, { at: ago(9) });
    await enqueue(tenants.a, { at: ago(8) });
    await enqueue(tenants.b, { at: ago(1) });

    const order = [];
    for (let i = 0; i < 3; i++) {
      order.push((await claim())!.tenantId);
    }
    expect(order).toEqual([tenants.a.id, tenants.b.id, tenants.a.id]);
  });

  it("skips jobs that are not yet due or of a kind the worker does not handle", async () => {
    await enqueue(tenants.a, { at: new Date(Date.now() + 60_000) });
    await enqueue(tenants.b, { at: ago(1), kind: "other.kind" });
    await expect(claim()).resolves.toBeNull();
  });

  it("extends a live lease but never revives an expired one", async () => {
    await enqueue(tenants.a, { at: ago(1) });
    const job = (await claim())!;

    const extended = await asWorker(() => heartbeatAiJob(db, job, 120_000));
    expect(extended!.getTime()).toBeGreaterThan(job.leaseExpiresAt.getTime());
    await expect(asWorker(() => heartbeatAiJob(db, { ...job, leaseToken: randomUUID() }, 120_000))).resolves.toBeNull();

    await expireLease(job);
    await expect(asWorker(() => heartbeatAiJob(db, job, 120_000))).resolves.toBeNull();
    const [row] = await db.select().from(aiJobs).where(eq(aiJobs.id, job.jobId));
    expect(row!.leaseExpiresAt!.getTime()).toBeLessThan(Date.now());
  });

  it("fences a worker whose lease expired, before and after another worker reclaims", async () => {
    await enqueue(tenants.a, { at: ago(1) });
    const stale = (await claim())!;
    await expireLease(stale);

    await expect(asWorker(() => markAiJobDispatched(db, stale))).rejects.toBeInstanceOf(AiJobLeaseLostError);
    await expect(asWorker(() => finishAiJobStep(db, stale, { type: "completed" }))).rejects.toBeInstanceOf(
      AiJobLeaseLostError,
    );

    const fresh = (await claim())!;
    expect(fresh).toMatchObject({ jobId: stale.jobId, attemptNumber: 2, uncertainPriorDispatch: false });
    await expect(asWorker(() => finishAiJobStep(db, stale, { type: "completed" }))).rejects.toBeInstanceOf(
      AiJobLeaseLostError,
    );

    const [job] = await db.select().from(aiJobs).where(eq(aiJobs.id, stale.jobId));
    expect(job).toMatchObject({ status: "leased", leaseToken: fresh.leaseToken, attemptCount: 2 });
    const attempts = await db.select().from(aiJobAttempts).orderBy(aiJobAttempts.attemptNumber);
    expect(attempts.map((a) => [a.attemptNumber, a.outcome, a.dispatchedAt])).toEqual([
      [1, "lease_expired", null],
      [2, null, null],
    ]);
  });

  it("reports an expired attempt that had begun dispatch as uncertain", async () => {
    await enqueue(tenants.a, { at: ago(1) });
    const first = (await claim())!;
    await asWorker(() => markAiJobDispatched(db, first));
    await expireLease(first);

    await expect(claim()).resolves.toMatchObject({ attemptNumber: 2, uncertainPriorDispatch: true });
  });

  it("lets the API cancel only its own tenant's never-claimed jobs", async () => {
    const mine = await enqueue(tenants.a, { at: ago(2) });
    const theirs = await enqueue(tenants.b, { at: ago(1) });
    const cancel = (tenantId: string, jobPublicId: string) =>
      runAsRole(sqlClient, "qos_app", () =>
        withTenantContext(db, tenantId, (tx) =>
          cancelUnclaimedAiJobInTx(tx, { jobPublicId, code: "not_started_in_time", message: "m" }),
        ),
      );

    await expect(cancel(tenants.a.id, theirs.publicId)).resolves.toBe(false);
    await expect(
      runAsRole(sqlClient, "qos_app", () => sqlClient`SELECT qos.cancel_queued_ai_job(${mine.publicId}, 'x', 'y')`),
    ).rejects.toThrow(/Tenant context is required/);

    const claimed = (await claim())!;
    expect(claimed.jobPublicId).toBe(mine.publicId);
    await asWorker(() => finishAiJobStep(db, claimed, { type: "reschedule", delayMs: 0 }));
    await expect(cancel(tenants.a.id, mine.publicId)).resolves.toBe(false);

    await expect(cancel(tenants.b.id, theirs.publicId)).resolves.toBe(true);
    const [row] = await db.select().from(aiJobs).where(eq(aiJobs.id, theirs.id));
    expect(row).toMatchObject({ status: "cancelled", lastErrorCode: "not_started_in_time" });
    expect(row!.finishedAt).not.toBeNull();
  });

  it("shows the worker no jobs outside a tenant context", async () => {
    await enqueue(tenants.a, { at: ago(1) });
    await expect(asWorker(() => db.select().from(aiJobs))).resolves.toEqual([]);
  });

  it("gives the scaler one count of due and leased work", async () => {
    await enqueue(tenants.a, { at: ago(2) });
    await enqueue(tenants.b, { at: ago(1) });
    await enqueue(tenants.b, { at: new Date(Date.now() + 60_000) });
    const done = await enqueue(tenants.a, { at: ago(3) });
    const claimed = (await claim())!;
    expect(claimed.jobId).toBe(done.id);
    await asWorker(() => finishAiJobStep(db, claimed, { type: "completed" }));
    await claim();

    const [row] = await runAsRole(sqlClient, "qos_ai_scaler", () => sqlClient`SELECT qos.count_due_ai_work() AS count`);
    expect(Number(row!.count)).toBe(2);
  });

  it("rejects illegal job transitions and rewrites of attempt evidence, even from the owner", async () => {
    await enqueue(tenants.a, { at: ago(1) });
    const job = (await claim())!;
    const id = job.jobId;

    await expect(sqlClient`UPDATE qos.ai_jobs SET tenant_id = ${tenants.b.id}::uuid WHERE id = ${id}::uuid`).rejects.toThrow();
    await expect(
      sqlClient`UPDATE qos.ai_jobs SET lease_token = gen_random_uuid() WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/cannot be replaced/);

    await asWorker(() => markAiJobDispatched(db, job));
    await expect(
      sqlClient`UPDATE qos.ai_job_attempts SET dispatched_at = now() WHERE lease_token = ${job.leaseToken}::uuid`,
    ).rejects.toThrow();
    await expect(
      sqlClient`UPDATE qos.ai_job_attempts SET worker_id = 'someone-else' WHERE lease_token = ${job.leaseToken}::uuid`,
    ).rejects.toThrow(/immutable/);

    await asWorker(() => finishAiJobStep(db, job, { type: "completed" }));
    await expect(sqlClient`UPDATE qos.ai_jobs SET status = 'queued' WHERE id = ${id}::uuid`).rejects.toThrow(/already/);
    await expect(
      sqlClient`UPDATE qos.ai_job_attempts SET outcome = 'failed' WHERE lease_token = ${job.leaseToken}::uuid`,
    ).rejects.toThrow(/already finished/);

    const queued = await enqueue(tenants.b, { at: ago(1) });
    await expect(
      sqlClient`UPDATE qos.ai_jobs SET status = 'completed', finished_at = now() WHERE id = ${queued.id}::uuid`,
    ).rejects.toThrow(/cannot move/);
  });

  it("keeps a run's execution mode fixed once created", async () => {
    const job = await enqueue(tenants.a, { at: ago(1) });
    await expect(
      sqlClient`UPDATE qos.agent_runs SET execution_mode = 'inline' WHERE id = ${job.agentRunId}::uuid`,
    ).rejects.toThrow(/immutable/);
  });
});
