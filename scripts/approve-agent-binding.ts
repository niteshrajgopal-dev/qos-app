import { createDbClient } from "@/db/client";
import { approveTenantAgentBinding } from "@/lib/agents/tenant-agent-bindings";

import { assertConfirmedDatabaseHost, readOperatorArgs, requireArg } from "./agent-operator-cli";

function usage() {
  return [
    "Approves the provider agent a tenant's capability may use (operator only).",
    "The binding starts disabled; a tenant Administrator enables it in Settings.",
    "",
    "  npm run agents:approve-binding -- --tenant <tenantId> --agent <providerAgentId>",
    "      --operator <you@company> --database-host <host> [--capability menu_manager]",
  ].join("\n");
}

async function main() {
  const args = readOperatorArgs({
    tenant: { type: "string" },
    agent: { type: "string" },
    operator: { type: "string" },
    capability: { type: "string" },
    "database-host": { type: "string" },
    help: { type: "boolean" },
  });
  if (args.help) {
    console.log(usage());
    return;
  }

  const tenantId = requireArg(args, "tenant");
  const providerAgentId = requireArg(args, "agent");
  const operator = requireArg(args, "operator");
  const databaseHost = assertConfirmedDatabaseHost(requireArg(args, "database-host"));
  const capability = typeof args.capability === "string" ? args.capability : "menu_manager";
  if (capability !== "menu_manager") {
    throw new Error(`Unknown capability ${capability}.`);
  }

  const { db, sql } = createDbClient();
  try {
    const binding = await approveTenantAgentBinding(db, {
      tenantId,
      capability,
      provider: "hyperagent",
      providerAgentId,
      approvedBySubject: operator,
    });
    console.log(
      `Approved ${capability} -> ${providerAgentId} for tenant ${tenantId} on ${databaseHost} ` +
        `(binding ${binding.publicId}, enabled: ${binding.enabled}).`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  console.error(`\n${usage()}`);
  process.exitCode = 1;
});
