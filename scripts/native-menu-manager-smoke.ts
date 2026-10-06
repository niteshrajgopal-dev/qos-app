/**
 * Owner-authorized native Menu Manager smoke. One paid review. Never CI.
 * DATABASE_URL + --database-host only; never loads a dotenv file. Prints
 * allowlisted JSON: status, spend, latency, usage. No prompts or keys.
 */

import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import {
  nativeSmokeReadiness,
  parseNativeSmokeArgs,
  redactNativeSmokeEvidence,
} from "@/lib/agents/native/native-smoke";

import { assertConfirmedDatabaseHost } from "./agent-operator-cli";

function usage() {
  return [
    "Owner-authorized native Menu Manager smoke (one paid review; never CI).",
    "Prints redacted JSON only. Set AGENT_NATIVE_SMOKE=true and the native spend policy.",
    "",
    "  npm run agents:native-smoke -- --confirm --tenant <tenantId> --menu <menuPublicId>",
    "      --operator <staff-subject> --database-host <host>",
  ].join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.length === 0) {
    console.log(usage());
    return;
  }

  const args = parseNativeSmokeArgs(argv);
  const databaseHost = assertConfirmedDatabaseHost(args.databaseHost);
  const readiness = nativeSmokeReadiness(process.env);
  if (!readiness.ready) {
    throw new Error(`Native smoke is not ready: ${readiness.missing.join(", ")}.`);
  }

  const { createDbClient } = await import("@/db/client");
  const { aiSpendReservations } = await import("@/db/schema");
  const { getAgentRun } = await import("@/lib/agents/agent-runs");
  const { readAgentConfig } = await import("@/lib/agents/config");
  const { createMenuManagerJobHandler } = await import("@/lib/agents/menu-manager/menu-manager-job");
  const { NATIVE_MENU_MANAGER_DEFINITION } = await import(
    "@/lib/agents/menu-manager/menu-manager-definition"
  );
  const { askMenuManager } = await import("@/lib/agents/menu-manager/menu-manager-service");
  const { createAgentsSdkModel } = await import("@/lib/agents/native/agents-sdk-model");
  const { readNativeModelConfig } = await import("@/lib/agents/native/native-model-config");
  const { claimNextAiJob, finishAiJobStep, markAiJobDispatched } = await import(
    "@/lib/ai/jobs/ai-job-queue"
  );
  const { requireAdministratorMembership } = await import("@/lib/staff/auth");
  const { withTenantContext } = await import("@/lib/tenant/context");

  const { db, sql } = createDbClient();
  try {
    const membership = await requireAdministratorMembership(db, args.tenantId, args.operator);
    const { run } = await askMenuManager(
      db,
      { tenantId: args.tenantId, subject: args.operator, membership },
      { menuPublicId: args.menuPublicId, idempotencyKey: `smoke-${randomBytes(8).toString("hex")}` },
      { config: readAgentConfig(), env: process.env },
    );

    try {
      await sql`SET ROLE qos_ai_worker`;
    } catch {
      throw new Error(
        "This login cannot assume qos_ai_worker. Use the local qos role after that grant, or the AI worker login.",
      );
    }
    const startedAt = Date.now();
    let jobResult = "not_claimed";
    try {
      const handler = createMenuManagerJobHandler(db, { model: createAgentsSdkModel(readNativeModelConfig()) });
      const job = await claimNextAiJob(db, {
        workerId: `native-smoke:${process.pid}`,
        jobKinds: ["menu_manager.run"],
        limits: { leaseMs: 60_000, maxActiveGlobal: 1, maxActivePerTenant: 1, maxActivePerKind: 1 },
      });
      if (!job) {
        throw new Error("No Menu Manager job was claimed. The admission may have failed.");
      }
      const result = await handler.step(job, {
        markDispatched: () => markAiJobDispatched(db, job),
        leaseLost: () => false,
      });
      await finishAiJobStep(db, job, result);
      jobResult = result.type;
    } finally {
      await sql`RESET ROLE`;
    }

    const finished = await getAgentRun(db, args.tenantId, run.publicId);
    const reservation = await withTenantContext(db, args.tenantId, async (tx) => {
      const [row] = await tx
        .select({
          state: aiSpendReservations.state,
          outcome: aiSpendReservations.outcome,
          reportedUsage: aiSpendReservations.reportedUsage,
        })
        .from(aiSpendReservations)
        .where(eq(aiSpendReservations.subjectPublicId, run.publicId))
        .limit(1);
      return row ?? null;
    });

    console.log(
      JSON.stringify(
        redactNativeSmokeEvidence({
          modelId: readiness.modelId,
          definitionVersion: finished.definitionVersion ?? "",
          runStatus: finished.status,
          jobResult,
          spendState: reservation?.state ?? null,
          spendOutcome: reservation?.outcome ?? null,
          reportedUsage: reservation?.reportedUsage ?? null,
          latencyMs: Date.now() - startedAt,
          productCount:
            typeof finished.requestSummary.productCount === "number" ? finished.requestSummary.productCount : 0,
          snapshotTruncated: finished.requestSummary.truncated === true,
          toolsAllowed: [...NATIVE_MENU_MANAGER_DEFINITION.allowedTools],
          databaseHost,
        }),
      ),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Native smoke failed.";
  console.error(message);
  console.error(`\n${usage()}`);
  process.exitCode = 1;
});
