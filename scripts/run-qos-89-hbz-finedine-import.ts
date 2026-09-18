/**
 * QOS-89 — run HBZ FineDine catalogue import from a machine that can reach Azure Postgres.
 *
 *   npm run ops:qos-89-hbz-finedine
 *   npm run ops:qos-89-hbz-finedine -- --live
 *   npm run ops:qos-89-hbz-finedine -- --fixture-only
 *   npm run ops:qos-89-hbz-finedine -- --verify-only
 *
 * Requires DATABASE_URL (never logged). Draft import only — does not publish.
 */

import { execSync } from "node:child_process";

import { createDbClient } from "@/db/client";
import { importQuotesHbzFineDineMenu } from "@/lib/catalogue/finedine-hbz-import";
import { QUOTES_HBZ_FINEDINE_IMPORT } from "@/lib/catalogue/finedine-hbz-constants";

async function probeDatabaseConnectivity(): Promise<boolean> {
  const { sql } = createDbClient();
  try {
    const rows = await sql`SELECT 1 AS ok`;
    console.log(`Database connectivity: OK (${rows[0]?.ok ?? "?"})`);
    return true;
  } catch (error) {
    const message = String(
      (error as { code?: string; message?: string })?.code ??
        (error as Error)?.message ??
        error,
    );
    console.error(`Database connectivity: FAILED (${message})`);

    if (/timeout|ETIMEDOUT|CONNECT_TIMEOUT/i.test(message)) {
      try {
        const egressIp = execSync("curl -s --max-time 5 ifconfig.me", {
          encoding: "utf8",
        }).trim();
        console.error(`Current egress IP: ${egressIp}`);
        console.error(
          "Add this IP to the Azure Postgres firewall for psql-qos-dev, then retry.",
        );
      } catch {
        console.error("Could not determine egress IP.");
      }
    }

    return false;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function runImport(useLiveSource: boolean) {
  const { db, sql } = createDbClient();

  try {
    const result = await importQuotesHbzFineDineMenu(db, { useLiveSource });

    console.log("\nQuotes HBZ FineDine import complete:");
    console.log(`  Location: ${QUOTES_HBZ_FINEDINE_IMPORT.locationPublicId}`);
    console.log(`  Connection key: ${QUOTES_HBZ_FINEDINE_IMPORT.connectionKey}`);
    console.log(`  Products: ${result.productCount}`);
    console.log(`  Menu sections: ${result.sectionCount}`);
    console.log(`  Draft menu: ${result.menuPublicId} (v${result.menuVersion})`);
    console.log(`  Import operation: ${result.importOperationPublicId}`);
    console.log(
      `  Import summary: created=${result.importReport.createCount}, updated=${result.importReport.updateCount}, unchanged=${result.importReport.unchangedCount}, errors=${result.importReport.errorCount}`,
    );
    console.log(`  Replayed import: ${result.replayedImport}`);
    console.log(`  Created menu: ${result.createdMenu}`);

    if (result.importReport.errorCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function runVerification() {
  execSync("npm run verify:quotes-hbz-finedine", {
    stdio: "inherit",
    env: process.env,
  });
}

async function main() {
  const args = process.argv.slice(2);
  const verifyOnly = args.includes("--verify-only");
  const fixtureOnly = args.includes("--fixture-only");
  const useLive = args.includes("--live");

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Export it before running this script.");
    process.exitCode = 1;
    return;
  }

  console.log("DATABASE_URL_present=yes");

  if (!verifyOnly) {
    const connected = await probeDatabaseConnectivity();
    if (!connected) {
      process.exitCode = 1;
      return;
    }

    if (fixtureOnly) {
      console.log("\nRunning fixture import (no --live)...");
      await runImport(false);
    } else if (useLive) {
      console.log("\nRunning live FineDine import...");
      try {
        await runImport(true);
      } catch (error) {
        console.error("\nLive import failed; falling back to committed fixture...");
        console.error(error);
        await runImport(false);
      }
    } else {
      console.log("\nRunning live FineDine import (default)...");
      try {
        await runImport(true);
      } catch (error) {
        console.error("\nLive import failed; falling back to committed fixture...");
        console.error(error);
        await runImport(false);
      }
    }
  }

  console.log("\nRunning post-import verification...");
  await runVerification();
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
