-- MANUAL (Nitesh): QOS-198 versioned recipes, preparation steps and sellable
-- links. Apply with the admin connection after 0062 (it references 0060's
-- inventory_items and inventory_units and the catalogue variants) and before
-- deploying the matching web/API image.
-- Journal `when` is 1793600000000 (after 0062's 1793500000000).
-- Additive only: six new tenant tables. No seeded rows and no change to any
-- existing table.
-- A recipe family (recipes) has numbered versions. A version is a draft until
-- approved; approved and discarded versions are read-only in the service, and
-- qos_app cannot change a version's identity columns or a line's version.
-- Approval writes a grant-immutable snapshot row (SELECT and INSERT only).
-- At most one open draft and one open-ended approved version per family, and
-- at most one active prepared family per output item.
-- Sellable links are append-only like 0062's reference costs: qos_app may only
-- set effective_to, so a link is ended and a new revision inserted, never
-- rewritten. One open link per variant makes a recipe link and a direct-stock
-- link mutually exclusive. Nothing here posts stock or production: there is no
-- stock table. No table grants DELETE (archive, discard or end only).

CREATE TABLE IF NOT EXISTS "qos"."recipes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "public_id" text NOT NULL,
  "name_en" text NOT NULL,
  "name_ar" text,
  "kind" text NOT NULL,
  "output_item_id" uuid,
  "notes" text,
  "status" text DEFAULT 'active' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "provenance" "qos"."data_provenance" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_subject" text,
  "updated_by_subject" text,
  CONSTRAINT "recipes_public_id_check" CHECK ("public_id" ~ '^rec_[a-z0-9_-]+$'),
  CONSTRAINT "recipes_name_en_check" CHECK (char_length(btrim("name_en")) BETWEEN 1 AND 120),
  CONSTRAINT "recipes_name_ar_check" CHECK ("name_ar" IS NULL OR char_length(btrim("name_ar")) BETWEEN 1 AND 120),
  CONSTRAINT "recipes_kind_check" CHECK ("kind" IN ('sellable', 'prepared')),
  CONSTRAINT "recipes_output_item_check" CHECK (("kind" = 'prepared') = ("output_item_id" IS NOT NULL)),
  CONSTRAINT "recipes_notes_check" CHECK ("notes" IS NULL OR char_length("notes") <= 1000),
  CONSTRAINT "recipes_status_check" CHECK ("status" IN ('active', 'archived')),
  CONSTRAINT "recipes_version_check" CHECK ("version" >= 1),
  CONSTRAINT "recipes_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "recipes_tenant_public_id_unique" UNIQUE ("tenant_id", "public_id"),
  CONSTRAINT "recipes_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "qos"."tenants"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "recipes_output_item_fk" FOREIGN KEY ("tenant_id", "output_item_id") REFERENCES "qos"."inventory_items"("tenant_id", "id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recipes_active_output_item_unique" ON "qos"."recipes" USING btree ("tenant_id", "output_item_id") WHERE "status" = 'active' AND "output_item_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recipes_tenant_id_idx" ON "qos"."recipes" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "qos"."recipes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."recipes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."recipes" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "qos"."recipes" TO qos_app;--> statement-breakpoint
CREATE POLICY "recipes_tenant_isolation" ON "qos"."recipes"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qos"."recipe_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "public_id" text NOT NULL,
  "recipe_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "effective_from" date,
  "effective_to" date,
  "yield_quantity_micros" bigint,
  "yield_unit_id" uuid,
  "notes" text,
  "approved_at" timestamp with time zone,
  "approved_by_subject" text,
  "version" integer DEFAULT 1 NOT NULL,
  "provenance" "qos"."data_provenance" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_subject" text,
  "updated_by_subject" text,
  CONSTRAINT "recipe_versions_public_id_check" CHECK ("public_id" ~ '^recv_[a-z0-9_-]+$'),
  CONSTRAINT "recipe_versions_version_number_check" CHECK ("version_number" >= 1),
  CONSTRAINT "recipe_versions_status_check" CHECK ("status" IN ('draft', 'approved', 'discarded')),
  CONSTRAINT "recipe_versions_yield_check" CHECK ("yield_quantity_micros" IS NULL OR "yield_quantity_micros" > 0),
  CONSTRAINT "recipe_versions_notes_check" CHECK ("notes" IS NULL OR char_length("notes") <= 1000),
  CONSTRAINT "recipe_versions_approved_check" CHECK ("status" <> 'approved' OR ("effective_from" IS NOT NULL AND "yield_quantity_micros" IS NOT NULL AND "yield_unit_id" IS NOT NULL AND "approved_at" IS NOT NULL)),
  CONSTRAINT "recipe_versions_unapproved_dates_check" CHECK ("status" = 'approved' OR ("effective_from" IS NULL AND "effective_to" IS NULL)),
  CONSTRAINT "recipe_versions_dates_check" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from"),
  CONSTRAINT "recipe_versions_version_check" CHECK ("version" >= 1),
  CONSTRAINT "recipe_versions_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "recipe_versions_tenant_public_id_unique" UNIQUE ("tenant_id", "public_id"),
  CONSTRAINT "recipe_versions_number_unique" UNIQUE ("tenant_id", "recipe_id", "version_number"),
  CONSTRAINT "recipe_versions_recipe_fk" FOREIGN KEY ("tenant_id", "recipe_id") REFERENCES "qos"."recipes"("tenant_id", "id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "recipe_versions_yield_unit_fk" FOREIGN KEY ("tenant_id", "yield_unit_id") REFERENCES "qos"."inventory_units"("tenant_id", "id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recipe_versions_open_draft_unique" ON "qos"."recipe_versions" USING btree ("tenant_id", "recipe_id") WHERE "status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recipe_versions_current_approved_unique" ON "qos"."recipe_versions" USING btree ("tenant_id", "recipe_id") WHERE "status" = 'approved' AND "effective_to" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recipe_versions_tenant_recipe_idx" ON "qos"."recipe_versions" USING btree ("tenant_id", "recipe_id");--> statement-breakpoint
ALTER TABLE "qos"."recipe_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."recipe_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."recipe_versions" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "qos"."recipe_versions" TO qos_app;--> statement-breakpoint
GRANT UPDATE ("status", "effective_from", "effective_to", "yield_quantity_micros", "yield_unit_id", "notes", "approved_at", "approved_by_subject", "version", "updated_at", "updated_by_subject") ON TABLE "qos"."recipe_versions" TO qos_app;--> statement-breakpoint
CREATE POLICY "recipe_versions_tenant_isolation" ON "qos"."recipe_versions"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qos"."recipe_version_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "public_id" text NOT NULL,
  "recipe_version_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "quantity_micros" bigint NOT NULL,
  "position" integer NOT NULL,
  "label_en" text,
  "label_ar" text,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_subject" text,
  "updated_by_subject" text,
  CONSTRAINT "recipe_version_lines_public_id_check" CHECK ("public_id" ~ '^recl_[a-z0-9_-]+$'),
  CONSTRAINT "recipe_version_lines_quantity_check" CHECK ("quantity_micros" > 0),
  CONSTRAINT "recipe_version_lines_position_check" CHECK ("position" >= 0),
  CONSTRAINT "recipe_version_lines_label_en_check" CHECK ("label_en" IS NULL OR char_length("label_en") <= 120),
  CONSTRAINT "recipe_version_lines_label_ar_check" CHECK ("label_ar" IS NULL OR char_length("label_ar") <= 120),
  CONSTRAINT "recipe_version_lines_status_check" CHECK ("status" IN ('active', 'removed')),
  CONSTRAINT "recipe_version_lines_tenant_public_id_unique" UNIQUE ("tenant_id", "public_id"),
  CONSTRAINT "recipe_version_lines_version_fk" FOREIGN KEY ("tenant_id", "recipe_version_id") REFERENCES "qos"."recipe_versions"("tenant_id", "id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "recipe_version_lines_item_fk" FOREIGN KEY ("tenant_id", "item_id") REFERENCES "qos"."inventory_items"("tenant_id", "id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "recipe_version_lines_unit_fk" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "qos"."inventory_units"("tenant_id", "id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recipe_version_lines_active_item_unique" ON "qos"."recipe_version_lines" USING btree ("tenant_id", "recipe_version_id", "item_id") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recipe_version_lines_tenant_version_idx" ON "qos"."recipe_version_lines" USING btree ("tenant_id", "recipe_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recipe_version_lines_tenant_item_idx" ON "qos"."recipe_version_lines" USING btree ("tenant_id", "item_id");--> statement-breakpoint
ALTER TABLE "qos"."recipe_version_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."recipe_version_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."recipe_version_lines" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "qos"."recipe_version_lines" TO qos_app;--> statement-breakpoint
GRANT UPDATE ("item_id", "unit_id", "quantity_micros", "position", "label_en", "label_ar", "status", "updated_at", "updated_by_subject") ON TABLE "qos"."recipe_version_lines" TO qos_app;--> statement-breakpoint
CREATE POLICY "recipe_version_lines_tenant_isolation" ON "qos"."recipe_version_lines"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qos"."recipe_version_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "public_id" text NOT NULL,
  "recipe_version_id" uuid NOT NULL,
  "position" integer NOT NULL,
  "text_en" text NOT NULL,
  "text_ar" text,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_subject" text,
  "updated_by_subject" text,
  CONSTRAINT "recipe_version_steps_public_id_check" CHECK ("public_id" ~ '^recs_[a-z0-9_-]+$'),
  CONSTRAINT "recipe_version_steps_position_check" CHECK ("position" >= 0),
  CONSTRAINT "recipe_version_steps_text_en_check" CHECK (char_length(btrim("text_en")) BETWEEN 1 AND 1000),
  CONSTRAINT "recipe_version_steps_text_ar_check" CHECK ("text_ar" IS NULL OR char_length(btrim("text_ar")) BETWEEN 1 AND 1000),
  CONSTRAINT "recipe_version_steps_status_check" CHECK ("status" IN ('active', 'removed')),
  CONSTRAINT "recipe_version_steps_tenant_public_id_unique" UNIQUE ("tenant_id", "public_id"),
  CONSTRAINT "recipe_version_steps_version_fk" FOREIGN KEY ("tenant_id", "recipe_version_id") REFERENCES "qos"."recipe_versions"("tenant_id", "id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recipe_version_steps_tenant_version_idx" ON "qos"."recipe_version_steps" USING btree ("tenant_id", "recipe_version_id");--> statement-breakpoint
ALTER TABLE "qos"."recipe_version_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."recipe_version_steps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."recipe_version_steps" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "qos"."recipe_version_steps" TO qos_app;--> statement-breakpoint
GRANT UPDATE ("position", "text_en", "text_ar", "status", "updated_at", "updated_by_subject") ON TABLE "qos"."recipe_version_steps" TO qos_app;--> statement-breakpoint
CREATE POLICY "recipe_version_steps_tenant_isolation" ON "qos"."recipe_version_steps"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qos"."recipe_version_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "recipe_version_id" uuid NOT NULL,
  "snapshot" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_subject" text,
  CONSTRAINT "recipe_version_snapshots_version_unique" UNIQUE ("tenant_id", "recipe_version_id"),
  CONSTRAINT "recipe_version_snapshots_version_fk" FOREIGN KEY ("tenant_id", "recipe_version_id") REFERENCES "qos"."recipe_versions"("tenant_id", "id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
ALTER TABLE "qos"."recipe_version_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."recipe_version_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."recipe_version_snapshots" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "qos"."recipe_version_snapshots" TO qos_app;--> statement-breakpoint
CREATE POLICY "recipe_version_snapshots_tenant_isolation" ON "qos"."recipe_version_snapshots"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qos"."recipe_sellable_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "public_id" text NOT NULL,
  "variant_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "recipe_id" uuid,
  "item_id" uuid,
  "quantity_micros" bigint,
  "unit_id" uuid,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "revision" integer NOT NULL,
  "provenance" "qos"."data_provenance" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_subject" text,
  CONSTRAINT "recipe_sellable_links_public_id_check" CHECK ("public_id" ~ '^link_[a-z0-9_-]+$'),
  CONSTRAINT "recipe_sellable_links_kind_check" CHECK ("kind" IN ('recipe', 'direct_stock')),
  CONSTRAINT "recipe_sellable_links_shape_check" CHECK (
    ("kind" = 'recipe' AND "recipe_id" IS NOT NULL AND "item_id" IS NULL AND "quantity_micros" IS NULL AND "unit_id" IS NULL)
    OR ("kind" = 'direct_stock' AND "recipe_id" IS NULL AND "item_id" IS NOT NULL AND "quantity_micros" IS NOT NULL AND "unit_id" IS NOT NULL)
  ),
  CONSTRAINT "recipe_sellable_links_quantity_check" CHECK ("quantity_micros" IS NULL OR "quantity_micros" > 0),
  CONSTRAINT "recipe_sellable_links_dates_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "recipe_sellable_links_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "recipe_sellable_links_tenant_public_id_unique" UNIQUE ("tenant_id", "public_id"),
  CONSTRAINT "recipe_sellable_links_revision_unique" UNIQUE ("tenant_id", "variant_id", "revision"),
  CONSTRAINT "recipe_sellable_links_variant_fk" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "qos"."catalogue_variants"("tenant_id", "id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "recipe_sellable_links_recipe_fk" FOREIGN KEY ("tenant_id", "recipe_id") REFERENCES "qos"."recipes"("tenant_id", "id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "recipe_sellable_links_item_fk" FOREIGN KEY ("tenant_id", "item_id") REFERENCES "qos"."inventory_items"("tenant_id", "id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "recipe_sellable_links_unit_fk" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "qos"."inventory_units"("tenant_id", "id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recipe_sellable_links_current_unique" ON "qos"."recipe_sellable_links" USING btree ("tenant_id", "variant_id") WHERE "effective_to" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recipe_sellable_links_tenant_recipe_idx" ON "qos"."recipe_sellable_links" USING btree ("tenant_id", "recipe_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recipe_sellable_links_tenant_item_idx" ON "qos"."recipe_sellable_links" USING btree ("tenant_id", "item_id");--> statement-breakpoint
ALTER TABLE "qos"."recipe_sellable_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."recipe_sellable_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."recipe_sellable_links" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "qos"."recipe_sellable_links" TO qos_app;--> statement-breakpoint
GRANT UPDATE ("effective_to") ON TABLE "qos"."recipe_sellable_links" TO qos_app;--> statement-breakpoint
CREATE POLICY "recipe_sellable_links_tenant_isolation" ON "qos"."recipe_sellable_links"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);

-- Down script (documentation only; not executed). Roll the application back first,
-- then run with the admin connection and delete the idx 63 row from
-- drizzle.__drizzle_migrations if it was recorded:
--   DROP TABLE IF EXISTS "qos"."recipe_sellable_links";
--   DROP TABLE IF EXISTS "qos"."recipe_version_snapshots";
--   DROP TABLE IF EXISTS "qos"."recipe_version_steps";
--   DROP TABLE IF EXISTS "qos"."recipe_version_lines";
--   DROP TABLE IF EXISTS "qos"."recipe_versions";
--   DROP TABLE IF EXISTS "qos"."recipes";
