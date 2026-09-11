import { createDbClient } from "@/db/client";
import { seedDevTenants } from "@/lib/seed/dev-tenants";

async function main() {
  const { db, sql } = createDbClient();
  const result = await seedDevTenants(db);

  console.log("Seeded development tenants:");
  console.log(`  Quotes tenant: ${result.quotesTenantId}`);
  console.log(`  Flower tenant: ${result.flowerTenantId}`);
  console.log(`  Quotes locations: ${result.quotesLocationIds.length}`);
  console.log(`  Flower products: ${result.flowerProductPublicIds.join(", ")}`);

  await sql.end({ timeout: 5 });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
