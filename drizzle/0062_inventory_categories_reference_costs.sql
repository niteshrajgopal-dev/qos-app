-- MANUAL (Nitesh): QOS-197 inventory categories, item category and notes, and
-- dated item reference costs. Apply with the admin connection after 0061 (it
-- extends 0060's inventory_items and references 0060's inventory_units) and
-- before deploying the matching web/API image.
-- Journal `when` is 1793500000000 (after 0061's 1793400000000).
-- Additive only: two new tenant tables and two nullable columns on
-- inventory_items. No seeded rows. Categories are flat; at most one active
-- category per tenant has a given English name (case and outer spaces
-- ignored); archived categories keep their name as history.
-- Reference costs are append-only like 0060's conversions: qos_app may only set
-- effective_to on a version row, so a stored amount is never rewritten. An item
-- with no current row has an unknown cost; a known zero is an explicit 0 row.
-- These costs are reference estimates, separate from 0059's catalogue cost
-- policies and from any stock valuation. No table grants DELETE (archive only).

CREATE TABLE IF NOT EXISTS "qos"."inventory_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "public_id" text NOT NULL,
  "name_en" text NOT NULL,
  "name_ar" text,
  "status" text DEFAULT 'active' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "provenance" "qos"."data_provenance" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_subject" text,
  "updated_by_subject" text,
  CONSTRAINT "inventory_categories_public_id_check" CHECK ("public_id" ~ '^invcat_[a-z0-9_-]+$'),
  CONSTRAINT "inventory_categories_name_en_check" CHECK (char_length(btrim("name_en")) BETWEEN 1 AND 120),
  CONSTRAINT "inventory_categories_name_ar_check" CHECK ("name_ar" IS NULL OR char_length(btrim("name_ar")) BETWEEN 1 AND 120),
  CONSTRAINT "inventory_categories_status_check" CHECK ("status" IN ('active', 'archived')),
  CONSTRAINT "inventory_categories_version_check" CHECK ("version" >= 1),
  CONSTRAINT "inventory_categories_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "inventory_categories_tenant_public_id_unique" UNIQUE ("tenant_id", "public_id"),
  CONSTRAINT "inventory_categories_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "qos"."tenants"("id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_categories_active_name_unique" ON "qos"."inventory_categories" USING btree ("tenant_id", lower(btrim("name_en"))) WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_categories_tenant_id_idx" ON "qos"."inventory_categories" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "qos"."inventory_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."inventory_categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."inventory_categories" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "qos"."inventory_categories" TO qos_app;--> statement-breakpoint
CREATE POLICY "inventory_categories_tenant_isolation" ON "qos"."inventory_categories"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "qos"."inventory_items" ADD COLUMN IF NOT EXISTS "category_id" uuid;--> statement-breakpoint
ALTER TABLE "qos"."inventory_items" ADD COLUMN IF NOT EXISTS "notes" text;--> statement-breakpoint
ALTER TABLE "qos"."inventory_items" ADD CONSTRAINT "inventory_items_category_fk" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "qos"."inventory_categories"("tenant_id", "id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."inventory_items" ADD CONSTRAINT "inventory_items_notes_check" CHECK ("notes" IS NULL OR char_length("notes") <= 1000);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_items_tenant_category_idx" ON "qos"."inventory_items" USING btree ("tenant_id", "category_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qos"."inventory_item_reference_costs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "public_id" text NOT NULL,
  "item_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "amount_micros" bigint NOT NULL,
  "currency" char(3) NOT NULL,
  "tax_basis" text NOT NULL,
  "source" text NOT NULL,
  "source_reference" text,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "revision" integer NOT NULL,
  "provenance" "qos"."data_provenance" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_subject" text,
  CONSTRAINT "inventory_item_reference_costs_public_id_check" CHECK ("public_id" ~ '^cost_[a-z0-9_-]+$'),
  CONSTRAINT "inventory_item_reference_costs_amount_check" CHECK ("amount_micros" >= 0),
  CONSTRAINT "inventory_item_reference_costs_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "inventory_item_reference_costs_tax_basis_check" CHECK ("tax_basis" IN ('net', 'gross', 'unconfirmed')),
  CONSTRAINT "inventory_item_reference_costs_source_check" CHECK ("source" IN ('manual', 'supplier_quote', 'invoice')),
  CONSTRAINT "inventory_item_reference_costs_source_reference_check" CHECK ("source_reference" IS NULL OR char_length("source_reference") <= 200),
  CONSTRAINT "inventory_item_reference_costs_dates_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "inventory_item_reference_costs_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "inventory_item_reference_costs_tenant_public_id_unique" UNIQUE ("tenant_id", "public_id"),
  CONSTRAINT "inventory_item_reference_costs_revision_unique" UNIQUE ("tenant_id", "item_id", "revision"),
  CONSTRAINT "inventory_item_reference_costs_item_fk" FOREIGN KEY ("tenant_id", "item_id") REFERENCES "qos"."inventory_items"("tenant_id", "id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "inventory_item_reference_costs_unit_fk" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "qos"."inventory_units"("tenant_id", "id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_item_reference_costs_current_unique" ON "qos"."inventory_item_reference_costs" USING btree ("tenant_id", "item_id") WHERE "effective_to" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_item_reference_costs_tenant_item_idx" ON "qos"."inventory_item_reference_costs" USING btree ("tenant_id", "item_id");--> statement-breakpoint
ALTER TABLE "qos"."inventory_item_reference_costs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."inventory_item_reference_costs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."inventory_item_reference_costs" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "qos"."inventory_item_reference_costs" TO qos_app;--> statement-breakpoint
GRANT UPDATE ("effective_to") ON TABLE "qos"."inventory_item_reference_costs" TO qos_app;--> statement-breakpoint
CREATE POLICY "inventory_item_reference_costs_tenant_isolation" ON "qos"."inventory_item_reference_costs"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);

-- Down script (documentation only; not executed). Roll the application back first,
-- then run with the admin connection and delete the idx 62 row from
-- drizzle.__drizzle_migrations if it was recorded:
--   DROP TABLE IF EXISTS "qos"."inventory_item_reference_costs";
--   DROP INDEX IF EXISTS "qos"."inventory_items_tenant_category_idx";
--   ALTER TABLE "qos"."inventory_items" DROP CONSTRAINT IF EXISTS "inventory_items_notes_check";
--   ALTER TABLE "qos"."inventory_items" DROP CONSTRAINT IF EXISTS "inventory_items_category_fk";
--   ALTER TABLE "qos"."inventory_items" DROP COLUMN IF EXISTS "notes";
--   ALTER TABLE "qos"."inventory_items" DROP COLUMN IF EXISTS "category_id";
--   DROP TABLE IF EXISTS "qos"."inventory_categories";
