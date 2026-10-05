/**
 * Operator AI spend reconciliation. DATABASE_URL + --database-host only;
 * never loads a dotenv file. Totals are application quotas, not an invoice ceiling.
 */

import { createDbClient } from "@/db/client";
import { resolveUncertainAiSpend } from "@/lib/ai/spend/spend-admission";
import {
  AI_SPEND_QUOTA_KIND,
  listDueUncertainAiSpend,
  parseAiSpendOperatorArgs,
  summarizeAiSpendUsage,
} from "@/lib/ai/spend/spend-reconciliation";
import { withTenantContext } from "@/lib/tenant/context";

import { assertConfirmedDatabaseHost } from "./agent-operator-cli";

function usage() {
  return [
    "Operator AI spend reconciliation (application quotas, not an invoice).",
    "",
    "  npm run ai:spend -- usage --database-host <host> [--tenant <tenantId>] [--path ai_photo.async]",
    "  npm run ai:spend -- due-uncertain --database-host <host> [--tenant <tenantId>]",
    "  npm run ai:spend -- resolve --database-host <host> --tenant <tenantId> --reservation spr_...",
    "      --resolution billed|not_billed --reason \"...\" --operator you@company",
  ].join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.length === 0) {
    console.log(usage());
    return;
  }

  const command = parseAiSpendOperatorArgs(argv);
  const databaseHost = assertConfirmedDatabaseHost(command.databaseHost);
  const { db, sql } = createDbClient();
  try {
    if (command.command === "usage") {
      const summary = command.tenantId
        ? await withTenantContext(db, command.tenantId, (tx) =>
            summarizeAiSpendUsage(tx, { path: command.path, tenantId: command.tenantId }),
          )
        : await db.transaction((tx) => summarizeAiSpendUsage(tx, { path: command.path }));
      console.log(JSON.stringify({ ...summary, databaseHost }, null, 2));
      return;
    }

    if (command.command === "due-uncertain") {
      const rows = command.tenantId
        ? await withTenantContext(db, command.tenantId, (tx) =>
            listDueUncertainAiSpend(tx, { tenantId: command.tenantId }),
          )
        : await db.transaction((tx) => listDueUncertainAiSpend(tx));
      console.log(
        JSON.stringify(
          rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString(), quotaKind: AI_SPEND_QUOTA_KIND })),
          null,
          2,
        ),
      );
      return;
    }

    const updated = await withTenantContext(db, command.tenantId, (tx) =>
      resolveUncertainAiSpend(tx, {
        tenantId: command.tenantId,
        reservationPublicId: command.reservationPublicId,
        resolution: command.resolution,
        reason: command.reason,
        resolvedBy: { subject: command.operator, actorClass: "operator" },
      }),
    );
    console.log(
      JSON.stringify(
        {
          publicId: updated.publicId,
          state: updated.state,
          resolution: updated.resolution,
          quotaKind: AI_SPEND_QUOTA_KIND,
          databaseHost,
        },
        null,
        2,
      ),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  if (error instanceof Error && error.cause instanceof Error) {
    console.error(`Cause: ${error.cause.message}`);
  }
  console.error(`\n${usage()}`);
  process.exitCode = 1;
});
