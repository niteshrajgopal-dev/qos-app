-- MANUAL (Nitesh): QOS-214 selling attributes and supplied nutrition metadata.
-- Apply order is 0054, then 0055, then 0056, then 0057. 0054 (QOS-212), 0055
-- (reserved for QOS-194) and 0056 (QOS-213) ship on separate branches; the
-- drizzle migrator skips any file whose journal "when" is older than the last
-- applied row, so apply those first wherever they are going to land.
-- Additive, nullable columns only. NULL means unknown / undeclared and is never
-- rewritten for existing rows. The tables already have RLS, FORCE RLS, the
-- tenant_isolation policy and qos_app grants; new columns inherit them.

ALTER TABLE "qos"."catalogue_products" ADD COLUMN IF NOT EXISTS "preparation_time_minutes" integer;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_products" ADD COLUMN IF NOT EXISTS "walking_time_minutes" integer;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_products" ADD COLUMN IF NOT EXISTS "high_salt" boolean;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_products" ADD COLUMN IF NOT EXISTS "direct_stock_intent" boolean;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_products" ADD CONSTRAINT "catalogue_products_preparation_time_minutes_check" CHECK ("preparation_time_minutes" IS NULL OR "preparation_time_minutes" >= 0);--> statement-breakpoint
ALTER TABLE "qos"."catalogue_products" ADD CONSTRAINT "catalogue_products_walking_time_minutes_check" CHECK ("walking_time_minutes" IS NULL OR "walking_time_minutes" >= 0);--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variants" ADD COLUMN IF NOT EXISTS "selling_quantity_basis" text;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variants" ADD COLUMN IF NOT EXISTS "price_unit" text;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variants" ADD COLUMN IF NOT EXISTS "price_unit_quantity" numeric;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variants" ADD CONSTRAINT "catalogue_variants_selling_quantity_basis_check" CHECK ("selling_quantity_basis" IS NULL OR "selling_quantity_basis" IN ('each', 'weight'));--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variants" ADD CONSTRAINT "catalogue_variants_price_unit_check" CHECK ("price_unit" IS NULL OR "price_unit" IN ('each', 'kg', 'g'));--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variants" ADD CONSTRAINT "catalogue_variants_price_unit_quantity_check" CHECK ("price_unit_quantity" IS NULL OR "price_unit_quantity" > 0);--> statement-breakpoint
ALTER TABLE "qos"."catalogue_modifier_options" ADD COLUMN IF NOT EXISTS "nutrition_calories" integer;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_modifier_options" ADD CONSTRAINT "catalogue_modifier_options_nutrition_calories_check" CHECK ("nutrition_calories" IS NULL OR "nutrition_calories" >= 0);

-- Down script (documentation only; not executed by the migrator). Run with the
-- admin connection, then delete the 0057 row from drizzle.__drizzle_migrations:
--   ALTER TABLE "qos"."catalogue_modifier_options" DROP COLUMN IF EXISTS "nutrition_calories";
--   ALTER TABLE "qos"."catalogue_variants" DROP COLUMN IF EXISTS "price_unit_quantity";
--   ALTER TABLE "qos"."catalogue_variants" DROP COLUMN IF EXISTS "price_unit";
--   ALTER TABLE "qos"."catalogue_variants" DROP COLUMN IF EXISTS "selling_quantity_basis";
--   ALTER TABLE "qos"."catalogue_products" DROP COLUMN IF EXISTS "direct_stock_intent";
--   ALTER TABLE "qos"."catalogue_products" DROP COLUMN IF EXISTS "high_salt";
--   ALTER TABLE "qos"."catalogue_products" DROP COLUMN IF EXISTS "walking_time_minutes";
--   ALTER TABLE "qos"."catalogue_products" DROP COLUMN IF EXISTS "preparation_time_minutes";
