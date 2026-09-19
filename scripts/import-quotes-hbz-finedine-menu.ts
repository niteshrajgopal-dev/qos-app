import { createAdminDbClient } from "@/db/client";
import { formatCatalogueImportCliReport } from "@/lib/catalogue/import-report";
import {
  formatQuotesHbzImportCliHelp,
  importQuotesHbzFineDineMenu,
  parseQuotesHbzImportCliArgs,
} from "@/lib/catalogue/finedine-hbz-import";
import { QUOTES_HBZ_FINEDINE_IMPORT } from "@/lib/catalogue/finedine-hbz-constants";

async function main() {
  const args = parseQuotesHbzImportCliArgs(process.argv.slice(2));

  if (args.help) {
    console.log(formatQuotesHbzImportCliHelp());
    return;
  }

  const { db, sql } = createAdminDbClient();

  try {
    const result = await importQuotesHbzFineDineMenu(db, {
      useLiveSource: args.useLiveSource,
      forceImageReingest: args.forceImageReingest,
      idempotencyKey: args.idempotencyKey,
      tenantId: args.tenantId,
      staffSubject: args.staffSubject,
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
