-- MANUAL (Nitesh): QOS-195 inventory units, items and item-scoped unit conversions.
-- Apply with the admin connection after 0059 and before deploying the matching
-- web/API image. Journal `when` is 1793300000000 (after 0059's 1793200000000).
-- Additive only: three new tenant tables, no change to any existing table and no
-- seeded rows. Standard units (mg, g, kg, ml, cl, l, piece) are code constants in
-- src/lib/inventory/standard-units.ts; a tenant row opts in through standard_code.
-- Conversions are append-only: qos_app may only set effective_to on a version row,
-- so a stored factor is never rewritten. No table grants DELETE (archive only).

CREATE TABLE IF NOT EXISTS "qos"."inventory_units" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "public_id" text NOT NULL,
  "code" text NOT NULL,
  "name_en" text NOT NULL,
  "name_ar" text NOT NULL,
  "quantity_kind" text NOT NULL,
  "standard_code" text,
  "decimal_places" integer NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "provenance" "qos"."data_provenance" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_subject" text,
  "updated_by_subject" text,
  CONSTRAINT "inventory_units_public_id_check" CHECK ("public_id" ~ '^unit_[a-z0-9_-]+$'),
  CONSTRAINT "inventory_units_code_check" CHECK ("code" ~ '^[a-z0-9][a-z0-9_-]{0,23}$'),
  CONSTRAINT "inventory_units_name_en_check" CHECK (char_length(btrim("name_en")) BETWEEN 1 AND 80),
  CONSTRAINT "inventory_units_name_ar_check" CHECK (char_length(btrim("name_ar")) BETWEEN 1 AND 80),
  CONSTRAINT "inventory_units_quantity_kind_check" CHECK ("quantity_kind" IN ('mass', 'volume', 'count', 'pack')),
  CONSTRAINT "inventory_units_standard_code_check" CHECK ("standard_code" IS NULL OR "standard_code" IN ('mg', 'g', 'kg', 'ml', 'cl', 'l', 'piece')),
  CONSTRAINT "inventory_units_decimal_places_check" CHECK ("decimal_places" BETWEEN 0 AND 6),
  CONSTRAINT "inventory_units_status_check" CHECK ("status" IN ('active', 'archived')),
  CONSTRAINT "inventory_units_version_check" CHECK ("version" >= 1),
  CONSTRAINT "inventory_units_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "inventory_units_tenant_public_id_unique" UNIQUE ("tenant_id", "public_id"),
  CONSTRAINT "inventory_units_tenant_code_unique" UNIQUE ("tenant_id", "code"),
  CONSTRAINT "inventory_units_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "qos"."tenants"("id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_units_tenant_standard_code_unique" ON "qos"."inventory_units" USING btree ("tenant_id", "standard_code") WHERE "standard_code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_units_tenant_id_idx" ON "qos"."inventory_units" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "qos"."inventory_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."inventory_units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."inventory_units" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "qos"."inventory_units" TO qos_app;--> statement-breakpoint
CREATE POLICY "inventory_units_tenant_isolation" ON "qos"."inventory_units"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qos"."inventory_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "public_id" text NOT NULL,
  "name_en" text NOT NULL,
  "name_ar" text,
  "kind" text NOT NULL,
  "storage_unit_id" uuid,
  "recipe_unit_id" uuid,
  "purchase_unit_id" uuid,
  "status" text DEFAULT 'active' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "provenance" "qos"."data_provenance" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_subject" text,
  "updated_by_subject" text,
  CONSTRAINT "inventory_items_public_id_check" CHECK ("public_id" ~ '^item_[a-z0-9_-]+$'),
  CONSTRAINT "inventory_items_name_en_check" CHECK (char_length(btrim("name_en")) BETWEEN 1 AND 120),
  CONSTRAINT "inventory_items_name_ar_check" CHECK ("name_ar" IS NULL OR char_length(btrim("name_ar")) BETWEEN 1 AND 120),
  CONSTRAINT "inventory_items_kind_check" CHECK ("kind" IN ('purchased', 'prepared')),
  CONSTRAINT "inventory_items_status_check" CHECK ("status" IN ('active', 'archived')),
  CONSTRAINT "inventory_items_version_check" CHECK ("version" >= 1),
  CONSTRAINT "inventory_items_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "inventory_items_tenant_public_id_unique" UNIQUE ("tenant_id", "public_id"),
  CONSTRAINT "inventory_items_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "qos"."tenants"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "inventory_items_storage_unit_fk" FOREIGN KEY ("tenant_id", "storage_unit_id") REFERENCES "qos"."inventory_units"("tenant_id", "id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "inventory_items_recipe_unit_fk" FOREIGN KEY ("tenant_id", "recipe_unit_id") REFERENCES "qos"."inventory_units"("tenant_id", "id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "inventory_items_purchase_unit_fk" FOREIGN KEY ("tenant_id", "purchase_unit_id") REFERENCES "qos"."inventory_units"("tenant_id", "id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_items_tenant_id_idx" ON "qos"."inventory_items" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "qos"."inventory_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."inventory_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."inventory_items" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "qos"."inventory_items" TO qos_app;--> statement-breakpoint
CREATE POLICY "inventory_items_tenant_isolation" ON "qos"."inventory_items"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qos"."inventory_item_conversions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "public_id" text NOT NULL,
  "item_id" uuid NOT NULL,
  "from_unit_id" uuid NOT NULL,
  "to_unit_id" uuid NOT NULL,
  "factor_micros" bigint NOT NULL,
  "justification" text,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "revision" integer NOT NULL,
  "provenance" "qos"."data_provenance" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_subject" text,
  CONSTRAINT "inventory_item_conversions_public_id_check" CHECK ("public_id" ~ '^conv_[a-z0-9_-]+$'),
  CONSTRAINT "inventory_item_conversions_units_check" CHECK ("from_unit_id" <> "to_unit_id"),
  CONSTRAINT "inventory_item_conversions_factor_check" CHECK ("factor_micros" > 0),
  CONSTRAINT "inventory_item_conversions_justification_check" CHECK ("justification" IS NULL OR char_length("justification") <= 200),
  CONSTRAINT "inventory_item_conversions_dates_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "inventory_item_conversions_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "inventory_item_conversions_tenant_public_id_unique" UNIQUE ("tenant_id", "public_id"),
  CONSTRAINT "inventory_item_conversions_revision_unique" UNIQUE ("tenant_id", "item_id", "from_unit_id", "to_unit_id", "revision"),
  CONSTRAINT "inventory_item_conversions_item_fk" FOREIGN KEY ("tenant_id", "item_id") REFERENCES "qos"."inventory_items"("tenant_id", "id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "inventory_item_conversions_from_unit_fk" FOREIGN KEY ("tenant_id", "from_unit_id") REFERENCES "qos"."inventory_units"("tenant_id", "id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "inventory_item_conversions_to_unit_fk" FOREIGN KEY ("tenant_id", "to_unit_id") REFERENCES "qos"."inventory_units"("tenant_id", "id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_item_conversions_current_unique" ON "qos"."inventory_item_conversions" USING btree ("tenant_id", "item_id", "from_unit_id", "to_unit_id") WHERE "effective_to" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_item_conversions_tenant_item_idx" ON "qos"."inventory_item_conversions" USING btree ("tenant_id", "item_id");--> statement-breakpoint
ALTER TABLE "qos"."inventory_item_conversions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."inventory_item_conversions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."inventory_item_conversions" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "qos"."inventory_item_conversions" TO qos_app;--> statement-breakpoint
GRANT UPDATE ("effective_to") ON TABLE "qos"."inventory_item_conversions" TO qos_app;--> statement-breakpoint
CREATE POLICY "inventory_item_conversions_tenant_isolation" ON "qos"."inventory_item_conversions"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);

-- Down script (documentation only; not executed). Roll the application back first,
-- then run with the admin connection and delete the idx 60 row from
-- drizzle.__drizzle_migrations if it was recorded:
--   DROP TABLE IF EXISTS "qos"."inventory_item_conversions";
--   DROP TABLE IF EXISTS "qos"."inventory_items";
--   DROP TABLE IF EXISTS "qos"."inventory_units";
