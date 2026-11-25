-- MANUAL (Nitesh): QOS-199 modifier effects on recipe versions. Apply with the
-- admin connection after 0063 (it references 0063's recipe_versions and
-- recipe_version_lines, 0060's inventory_items and inventory_units and the
-- catalogue modifier options) and before deploying the matching web/API image.
-- Journal `when` is 1793700000000 (after 0063's 1793600000000).
-- Additive only: one new tenant table and one unique constraint on
-- recipe_version_lines so an effect can reference a line of the same version
-- by composite foreign key. No seeded rows and no data change.
-- An effect says what one selected modifier option adds to (add), removes from
-- (remove) or replaces in (replace) one recipe version. remove and replace
-- target one base line of the same version by id, never by name. Effects are
-- edited only while the version is a draft (service rule, like lines and
-- steps); qos_app cannot change an effect's version, option or public id.
-- Rows are marked removed, never deleted. Nothing here posts stock or
-- production.

ALTER TABLE "qos"."recipe_version_lines" ADD CONSTRAINT "recipe_version_lines_tenant_version_id_unique" UNIQUE ("tenant_id", "recipe_version_id", "id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qos"."recipe_version_modifier_effects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "public_id" text NOT NULL,
  "recipe_version_id" uuid NOT NULL,
  "modifier_option_id" uuid NOT NULL,
  "effect_type" text NOT NULL,
  "target_line_id" uuid,
  "item_id" uuid,
  "unit_id" uuid,
  "quantity_micros" bigint,
  "notes" text,
  "position" integer NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_subject" text,
  "updated_by_subject" text,
  CONSTRAINT "recipe_version_modifier_effects_public_id_check" CHECK ("public_id" ~ '^eff_[a-z0-9_-]+$'),
  CONSTRAINT "recipe_version_modifier_effects_type_check" CHECK ("effect_type" IN ('add', 'remove', 'replace')),
  CONSTRAINT "recipe_version_modifier_effects_shape_check" CHECK (
    ("effect_type" = 'add' AND "target_line_id" IS NULL AND "item_id" IS NOT NULL AND "unit_id" IS NOT NULL AND "quantity_micros" IS NOT NULL)
    OR ("effect_type" = 'remove' AND "target_line_id" IS NOT NULL AND "item_id" IS NULL AND "unit_id" IS NULL AND "quantity_micros" IS NULL)
    OR ("effect_type" = 'replace' AND "target_line_id" IS NOT NULL AND "item_id" IS NOT NULL AND "unit_id" IS NOT NULL AND "quantity_micros" IS NOT NULL)
  ),
  CONSTRAINT "recipe_version_modifier_effects_quantity_check" CHECK ("quantity_micros" IS NULL OR "quantity_micros" > 0),
  CONSTRAINT "recipe_version_modifier_effects_notes_check" CHECK ("notes" IS NULL OR char_length("notes") <= 200),
  CONSTRAINT "recipe_version_modifier_effects_position_check" CHECK ("position" >= 0),
  CONSTRAINT "recipe_version_modifier_effects_status_check" CHECK ("status" IN ('active', 'removed')),
  CONSTRAINT "recipe_version_modifier_effects_tenant_public_id_unique" UNIQUE ("tenant_id", "public_id"),
  CONSTRAINT "recipe_version_modifier_effects_version_fk" FOREIGN KEY ("tenant_id", "recipe_version_id") REFERENCES "qos"."recipe_versions"("tenant_id", "id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "recipe_version_modifier_effects_option_fk" FOREIGN KEY ("tenant_id", "modifier_option_id") REFERENCES "qos"."catalogue_modifier_options"("tenant_id", "id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "recipe_version_modifier_effects_target_line_fk" FOREIGN KEY ("tenant_id", "recipe_version_id", "target_line_id") REFERENCES "qos"."recipe_version_lines"("tenant_id", "recipe_version_id", "id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "recipe_version_modifier_effects_item_fk" FOREIGN KEY ("tenant_id", "item_id") REFERENCES "qos"."inventory_items"("tenant_id", "id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "recipe_version_modifier_effects_unit_fk" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "qos"."inventory_units"("tenant_id", "id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recipe_version_modifier_effects_active_target_unique" ON "qos"."recipe_version_modifier_effects" USING btree ("tenant_id", "recipe_version_id", "modifier_option_id", "target_line_id") WHERE "status" = 'active' AND "target_line_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recipe_version_modifier_effects_active_add_unique" ON "qos"."recipe_version_modifier_effects" USING btree ("tenant_id", "recipe_version_id", "modifier_option_id", "item_id") WHERE "status" = 'active' AND "effect_type" = 'add';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recipe_version_modifier_effects_tenant_version_idx" ON "qos"."recipe_version_modifier_effects" USING btree ("tenant_id", "recipe_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recipe_version_modifier_effects_tenant_option_idx" ON "qos"."recipe_version_modifier_effects" USING btree ("tenant_id", "modifier_option_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recipe_version_modifier_effects_tenant_item_idx" ON "qos"."recipe_version_modifier_effects" USING btree ("tenant_id", "item_id");--> statement-breakpoint
ALTER TABLE "qos"."recipe_version_modifier_effects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."recipe_version_modifier_effects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."recipe_version_modifier_effects" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "qos"."recipe_version_modifier_effects" TO qos_app;--> statement-breakpoint
GRANT UPDATE ("effect_type", "target_line_id", "item_id", "unit_id", "quantity_micros", "notes", "position", "status", "updated_at", "updated_by_subject") ON TABLE "qos"."recipe_version_modifier_effects" TO qos_app;--> statement-breakpoint
CREATE POLICY "recipe_version_modifier_effects_tenant_isolation" ON "qos"."recipe_version_modifier_effects"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);

-- Down script (documentation only; not executed). Roll the application back first,
-- then run with the admin connection and delete the idx 64 row from
-- drizzle.__drizzle_migrations if it was recorded:
--   DROP TABLE IF EXISTS "qos"."recipe_version_modifier_effects";
--   ALTER TABLE "qos"."recipe_version_lines" DROP CONSTRAINT IF EXISTS "recipe_version_lines_tenant_version_id_unique";
