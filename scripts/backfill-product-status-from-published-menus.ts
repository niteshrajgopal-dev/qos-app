#!/usr/bin/env node
import postgres from "postgres";

/**
 * QOS-115 follow-up backfill script
 *
 * Issue: Products included in published menus remain in 'draft' status because
 * menu publishing never updated product.status.
 *
 * This script marks products as 'active' if they are currently published through
 * any menu, as long as they are still in 'draft' status.
 *
 * Safe to run multiple times (idempotent).
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." node scripts/backfill-product-status-from-published-menus.ts
 */

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    ssl: databaseUrl.includes("localhost")
      ? false
      : { rejectUnauthorized: true, minVersion: "TLSv1.2" },
  });

  console.log("Finding products published in menus but still marked draft...");

  const [result] = await sql<
    { product_count: number }[]
  >`
    WITH published_products AS (
      SELECT DISTINCT
        (jsonb_array_elements(
          jsonb_array_elements(mlr.payload->'sections')->'products'
        )->>'productPublicId')::text AS product_public_id
      FROM qos.catalogue_menu_live_revisions mlr
    )
    UPDATE qos.catalogue_products p
    SET
      status = 'active',
      updated_at = NOW()
    FROM published_products pp
    WHERE
      p.public_id = pp.product_public_id
      AND p.status = 'draft'
    RETURNING *
  `;

  const updatedCount = result?.product_count ?? 0;

  console.log(
    `Backfill complete: ${updatedCount} products marked as active.`,
  );

  await sql.end({ timeout: 5 });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Backfill failed.");
  process.exit(1);
});
