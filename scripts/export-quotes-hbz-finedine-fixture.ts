import { writeFileSync } from "node:fs";

import { buildQuotesHbzFineDineCatalogueImportCsv } from "@/lib/catalogue/finedine-hbz-import";
import { QUOTES_HBZ_FINEDINE_IMPORT } from "@/lib/catalogue/finedine-hbz-constants";

async function main() {
  const useLiveSource = process.argv.includes("--live");
  const csv = await buildQuotesHbzFineDineCatalogueImportCsv(useLiveSource);
  writeFileSync(QUOTES_HBZ_FINEDINE_IMPORT.csvFixturePath, csv);

  console.log(
    `Wrote ${QUOTES_HBZ_FINEDINE_IMPORT.csvFixturePath} (${csv.trim().split("\n").length - 1} rows).`,
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
