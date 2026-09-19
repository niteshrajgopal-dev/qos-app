import { createAdminDbClient } from "@/db/client";
import { formatCatalogueImportCliReport } from "@/lib/catalogue/import-report";
import { importQuotesHbzFineDineMenu } from "@/lib/catalogue/finedine-hbz-import";
import { QUOTES_HBZ_FINEDINE_IMPORT } from "@/lib/catalogue/finedine-hbz-constants";

async function main() {
  const useLiveSource = process.argv.includes("--live");
  const idempotencyKey = process.argv
    .find((arg) => arg.startsWith("--idempotency-key="))
    ?.split("=")
    .slice(1)
    .join("=");
  const tenantId = process.argv
    .find((arg) => arg.startsWith("--tenant-id="))
    ?.split("=")
    .slice(1)
    .join("=");
  const staffSubject = process.argv
    .find((arg) => arg.startsWith("--staff-subject="))
    ?.split("=")
    .slice(1)
    .join("=");

  const { db, sql } = createAdminDbClient();

  try {
    const result = await importQuotesHbzFineDineMenu(db, {
      useLiveSource,
      idempotencyKey,
      tenantId,
      staffSubject,
    });

    console.log("Quotes HBZ FineDine import complete:");
    console.log(`  Location: ${QUOTES_HBZ_FINEDINE_IMPORT.locationPublicId}`);
    console.log(`  Connection key: ${QUOTES_HBZ_FINEDINE_IMPORT.connectionKey}`);
    console.log(`  Products: ${result.productCount}`);
    console.log(`  Menu sections: ${result.sectionCount}`);
    console.log(`  Draft menu: ${result.menuPublicId} (v${result.menuVersion})`);
    console.log(`  Import operation: ${result.importOperationPublicId}`);
    console.log(
      formatCatalogueImportCliReport({
        createCount: result.importReport.createCount,
        updateCount: result.importReport.updateCount,
        unchangedCount: result.importReport.unchangedCount,
        errorCount: result.importReport.errorCount,
        media: result.importReport.media,
        errorCategories: result.importReport.errorCategories,
      }),
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
