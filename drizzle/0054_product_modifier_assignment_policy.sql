-- MANUAL (Nitesh): QOS-212 product-specific modifier selection and repeat policy. Nullable overrides on the existing product/group link; NULL inherits the group bounds and option repeat limits, so existing rows keep their behaviour. RLS (ENABLE + FORCE) and qos_app grants already cover this table.
ALTER TABLE "qos"."catalogue_product_modifier_groups" ADD COLUMN IF NOT EXISTS "min_selections" integer;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_modifier_groups" ADD COLUMN IF NOT EXISTS "max_selections" integer;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_modifier_groups" ADD COLUMN IF NOT EXISTS "repeat_allowed" boolean;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_modifier_groups" ADD COLUMN IF NOT EXISTS "selection_count_mode" text;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_modifier_groups" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_modifier_groups" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_modifier_groups" ADD CONSTRAINT "catalogue_product_modifier_groups_min_selections_check" CHECK ("min_selections" IS NULL OR "min_selections" >= 0);--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_modifier_groups" ADD CONSTRAINT "catalogue_product_modifier_groups_max_selections_check" CHECK ("max_selections" IS NULL OR "max_selections" >= 0);--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_modifier_groups" ADD CONSTRAINT "catalogue_product_modifier_groups_bounds_check" CHECK ("min_selections" IS NULL OR "max_selections" IS NULL OR "min_selections" <= "max_selections");--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_modifier_groups" ADD CONSTRAINT "catalogue_product_modifier_groups_selection_count_mode_check" CHECK ("selection_count_mode" IS NULL OR "selection_count_mode" IN ('distinct_options', 'total_quantity'));--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_modifier_groups" ADD CONSTRAINT "catalogue_product_modifier_groups_version_check" CHECK ("version" >= 1);
-- Down script (documentation only; not executed by the migrator). Run manually with the admin connection, then delete the
-- idx 54 row from drizzle.__drizzle_migrations if you also want the migrator to re-apply it:
--   ALTER TABLE "qos"."catalogue_product_modifier_groups" DROP CONSTRAINT IF EXISTS "catalogue_product_modifier_groups_version_check";
--   ALTER TABLE "qos"."catalogue_product_modifier_groups" DROP CONSTRAINT IF EXISTS "catalogue_product_modifier_groups_selection_count_mode_check";
--   ALTER TABLE "qos"."catalogue_product_modifier_groups" DROP CONSTRAINT IF EXISTS "catalogue_product_modifier_groups_bounds_check";
--   ALTER TABLE "qos"."catalogue_product_modifier_groups" DROP CONSTRAINT IF EXISTS "catalogue_product_modifier_groups_max_selections_check";
--   ALTER TABLE "qos"."catalogue_product_modifier_groups" DROP CONSTRAINT IF EXISTS "catalogue_product_modifier_groups_min_selections_check";
--   ALTER TABLE "qos"."catalogue_product_modifier_groups" DROP COLUMN IF EXISTS "updated_at";
--   ALTER TABLE "qos"."catalogue_product_modifier_groups" DROP COLUMN IF EXISTS "version";
--   ALTER TABLE "qos"."catalogue_product_modifier_groups" DROP COLUMN IF EXISTS "selection_count_mode";
--   ALTER TABLE "qos"."catalogue_product_modifier_groups" DROP COLUMN IF EXISTS "repeat_allowed";
--   ALTER TABLE "qos"."catalogue_product_modifier_groups" DROP COLUMN IF EXISTS "max_selections";
--   ALTER TABLE "qos"."catalogue_product_modifier_groups" DROP COLUMN IF EXISTS "min_selections";
