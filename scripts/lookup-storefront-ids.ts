import postgres from "postgres";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required.");
  }

  const sql = postgres(connectionString);

  const storefrontCount = await sql`SELECT count(*)::int AS count FROM qos.storefronts`;
  const domainCount = await sql`SELECT count(*)::int AS count FROM qos.storefront_domains`;

  const rows = await sql`
    SELECT
      s.public_id AS storefront_public_id,
      d.hostname,
      l.public_id AS location_public_id,
      l.name AS location_name
    FROM qos.storefronts s
    LEFT JOIN qos.storefront_domains d
      ON d.storefront_id = s.id
     AND d.tenant_id = s.tenant_id
    LEFT JOIN qos.storefront_locations sl
      ON sl.storefront_id = s.id
     AND sl.tenant_id = s.tenant_id
    LEFT JOIN qos.locations l
      ON l.id = sl.location_id
     AND l.tenant_id = sl.tenant_id
    ORDER BY d.hostname NULLS LAST, l.name NULLS LAST
  `;

  console.log(
    JSON.stringify(
      {
        storefrontCount: storefrontCount[0]?.count ?? 0,
        domainCount: domainCount[0]?.count ?? 0,
        rows,
      },
      null,
      2,
    ),
  );
  await sql.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
