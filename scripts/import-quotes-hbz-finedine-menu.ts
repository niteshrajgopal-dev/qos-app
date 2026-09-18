import { createDbClient } from "@/db/client";
import { importQuotesHbzFineDineMenu } from "@/lib/catalogue/finedine-hbz-import";
import { QUOTES_HBZ_FINEDINE_IMPORT } from "@/lib/catalogue/finedine-hbz-constants";

async function main() {
  const useLiveSource = process.argv.includes("--live");
  const idempotencyKey = process.argv
    .find((arg) => arg.startsWith("--idempotency-key="))
    ?.split("=")
    .slice(1)
    .join("=");

  const { db, sql } = createDbClient();

  try {
    const result = await importQuotesHbzFineDineMenu(db, {
      useLiveSource,
      idempotencyKey,
    });

    console.log("Quotes HBZ FineDine import complete:");
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
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
