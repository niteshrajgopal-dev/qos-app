import { createDbClient } from "@/db/client";
import {
  approveAndPublishQuotesHbzFineDineMenu,
  QUOTES_HBZ_FINEDINE_OPS_DEFAULT_STAFF_SUBJECT,
} from "@/lib/catalogue/finedine-hbz-approve-publish";
import { QUOTES_HBZ_FINEDINE_IMPORT } from "@/lib/catalogue/finedine-hbz-constants";

function readFlagValue(flag: string) {
  const prefix = `${flag}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match?.slice(prefix.length).trim() || undefined;
}

async function main() {
  const menuPublicId = readFlagValue("--menu-public-id");
  const staffSubject =
    readFlagValue("--staff-subject") ??
    QUOTES_HBZ_FINEDINE_OPS_DEFAULT_STAFF_SUBJECT;

  const { db, sql } = createDbClient();

  try {
    const result = await approveAndPublishQuotesHbzFineDineMenu(db, {
      menuPublicId,
      staffSubject,
    });

    console.log("Quotes HBZ FineDine approve + publish complete:");
    console.log(`  Location: ${QUOTES_HBZ_FINEDINE_IMPORT.locationPublicId}`);
    console.log(`  Draft menu: ${result.menuPublicId}`);
    console.log(`  Products: ${result.productCount}`);
    console.log(
      `  Translation approvals: approved=${result.translationApprovals.approved}, skipped=${result.translationApprovals.skipped}`,
    );
    console.log(`  Publish status: ${result.publish.status}`);
    console.log(
      `  Publish locations succeeded: ${result.publish.results.filter((entry) => entry.success).length}/${result.publish.results.length}`,
    );
    console.log(
      `  Storefront assignment: ${result.storefront.locationPublicId} -> ${result.storefront.menuPublicId}`,
    );
    console.log(
      `  Storefront release: ${result.storefront.releasePublicId} (v${result.storefront.releaseVersion})`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
