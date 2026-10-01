import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createIntegrationDb, hasIntegrationDatabase } from "@/db/test-utils";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("0039 AI photo candidates migration", () => {
  let connection: Awaited<ReturnType<typeof createIntegrationDb>>;
  let previousFolder: string;

  beforeAll(async () => {
    connection = await createIntegrationDb();
    previousFolder = await mkdtemp(path.join(os.tmpdir(), "qos-drizzle-0038-"));
    await cp(path.join(process.cwd(), "drizzle"), previousFolder, { recursive: true });

    const journalPath = path.join(previousFolder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    const cutoff = journal.entries.findIndex((entry) => entry.tag === "0039_ai_photo_candidates");
    journal.entries = journal.entries.slice(0, cutoff);
    await writeFile(journalPath, JSON.stringify(journal));
  }, 60_000);

  afterAll(async () => {
    await connection.sql.end({ timeout: 5 });
    await rm(previousFolder, { recursive: true, force: true });
  });

  it("adds ai_generated provenance and generation metadata without touching existing media", async () => {
    const { db, sql } = connection;
    await sql`DROP SCHEMA IF EXISTS qos CASCADE`;
    await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;

    await migrate(db, { migrationsFolder: previousFolder });
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const tenantId = quotes.tenant.id;
    const [product] = await sql`
      INSERT INTO qos.catalogue_products (tenant_id, brand_id, public_id, internal_name, provenance)
      VALUES (${tenantId}, ${quotes.brand.id}, 'prd_existing', 'existing', 'operator_entered')
      RETURNING id`;
    await sql`
      INSERT INTO qos.catalogue_media_assets (tenant_id, product_id, public_id, status, source_provenance)
      VALUES (${tenantId}, ${product!.id}, 'mas_existing', 'approved', 'imported')`;

    await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });

    const [existing] = await sql`
      SELECT status, source_provenance, generation_metadata
      FROM qos.catalogue_media_assets WHERE public_id = 'mas_existing'`;
    expect(existing).toMatchObject({
      status: "approved",
      source_provenance: "imported",
      generation_metadata: null,
    });

    const labels = await sql`
      SELECT enumlabel FROM pg_enum
      WHERE enumtypid = 'qos.data_provenance'::regtype ORDER BY enumsortorder`;
    expect(labels.map((row) => row.enumlabel)).toContain("ai_generated");

    await sql`
      INSERT INTO qos.catalogue_media_assets (tenant_id, product_id, public_id, source_provenance, generation_metadata)
      VALUES (${tenantId}, ${product!.id}, 'mas_ai', 'ai_generated', ${JSON.stringify({ schema: "qos.ai_photo_generation.v1" })}::jsonb)`;
    const [ai] = await sql`
      SELECT status, generation_metadata FROM qos.catalogue_media_assets WHERE public_id = 'mas_ai'`;
    expect(ai).toMatchObject({
      status: "pending_upload",
      generation_metadata: { schema: "qos.ai_photo_generation.v1" },
    });

    const indexes = await sql`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'qos' AND indexname = 'catalogue_media_assets_tenant_provenance_created_idx'`;
    expect(indexes).toHaveLength(1);
  }, 120_000);
});
