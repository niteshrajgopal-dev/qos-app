-- MANUAL (Nitesh): QOS-215 selling-price tax interpretation and reference-cost policies.
-- Apply with the admin connection before deploying the matching web/API image.
-- Apply order is 0054, then 0055, then 0056, then 0057, then 0058, then 0059.
-- 0054 is QOS-212, 0055 is QOS-194, 0056 is QOS-213, 0057 is QOS-214 and 0058 is
-- reserved for QOS-217. This file depends on none of them, but its journal `when`
-- (1793200000000) is the largest: if 0059 is applied first, a later `db:migrate`
-- can skip the earlier files because their `when` values are smaller.
-- Additive only: three nullable columns on catalogue_variants (no backfill, no
-- Phase 1 test rate substituted) and two append-only policy tables.

ALTER TABLE "qos"."catalogue_variants" ADD COLUMN IF NOT EXISTS "price_tax_basis" text;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variants" ADD COLUMN IF NOT EXISTS "tax_rate_basis_points" integer;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variants" ADD COLUMN IF NOT EXISTS "tax_provenance" "qos"."data_provenance";--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variants" ADD CONSTRAINT "catalogue_variants_price_tax_basis_check" CHECK ("price_tax_basis" IS NULL OR "price_tax_basis" IN ('inclusive', 'exclusive', 'unconfirmed'));--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variants" ADD CONSTRAINT "catalogue_variants_tax_rate_basis_points_check" CHECK ("tax_rate_basis_points" IS NULL OR "tax_rate_basis_points" >= 0);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qos"."catalogue_variant_reference_cost_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "public_id" text NOT NULL,
  "variant_id" uuid NOT NULL,
  "method" text NOT NULL,
  "amount_micros" bigint,
  "currency" char(3),
  "unit" text,
  "tax_basis" text,
  "effective_from" date,
  "effective_to" date,
  "source" text,
  "source_reference" text,
  "revision" integer NOT NULL,
  "provenance" "qos"."data_provenance",
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_subject" text,
  CONSTRAINT "catalogue_variant_ref_cost_method_check" CHECK ("method" IN ('manual', 'recipe_derived')),
  CONSTRAINT "catalogue_variant_ref_cost_amount_check" CHECK ("amount_micros" IS NULL OR "amount_micros" >= 0),
  CONSTRAINT "catalogue_variant_ref_cost_method_amount_check" CHECK (
    ("method" = 'manual' AND "amount_micros" IS NOT NULL AND "currency" IS NOT NULL AND "effective_from" IS NOT NULL)
    OR ("method" = 'recipe_derived' AND "amount_micros" IS NULL)
  ),
  CONSTRAINT "catalogue_variant_ref_cost_currency_check" CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "catalogue_variant_ref_cost_unit_check" CHECK ("unit" IS NULL OR "unit" IN ('each', 'kg', 'g')),
  CONSTRAINT "catalogue_variant_ref_cost_tax_basis_check" CHECK ("tax_basis" IS NULL OR "tax_basis" IN ('net', 'gross', 'unconfirmed')),
  CONSTRAINT "catalogue_variant_ref_cost_dates_check" CHECK ("effective_to" IS NULL OR "effective_from" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "catalogue_variant_ref_cost_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "catalogue_variant_ref_cost_tenant_public_id_unique" UNIQUE ("tenant_id", "public_id"),
  CONSTRAINT "catalogue_variant_ref_cost_revision_unique" UNIQUE ("tenant_id", "variant_id", "revision"),
  CONSTRAINT "catalogue_variant_ref_cost_variant_fk" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "qos"."catalogue_variants"("tenant_id", "id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "catalogue_variant_ref_cost_current_unique" ON "qos"."catalogue_variant_reference_cost_policies" USING btree ("tenant_id", "variant_id") WHERE "effective_to" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_variant_ref_cost_tenant_id_idx" ON "qos"."catalogue_variant_reference_cost_policies" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variant_reference_cost_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variant_reference_cost_policies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."catalogue_variant_reference_cost_policies" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "qos"."catalogue_variant_reference_cost_policies" TO qos_app;--> statement-breakpoint
GRANT UPDATE ("effective_to") ON TABLE "qos"."catalogue_variant_reference_cost_policies" TO qos_app;--> statement-breakpoint
CREATE POLICY "catalogue_variant_reference_cost_policies_tenant_isolation" ON "qos"."catalogue_variant_reference_cost_policies"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qos"."catalogue_modifier_option_reference_cost_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "public_id" text NOT NULL,
  "modifier_option_id" uuid NOT NULL,
  "method" text NOT NULL,
  "amount_micros" bigint,
  "currency" char(3),
  "unit" text,
  "tax_basis" text,
  "effective_from" date,
  "effective_to" date,
  "source" text,
  "source_reference" text,
  "revision" integer NOT NULL,
  "provenance" "qos"."data_provenance",
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_subject" text,
  CONSTRAINT "catalogue_option_ref_cost_method_check" CHECK ("method" IN ('manual', 'recipe_derived')),
  CONSTRAINT "catalogue_option_ref_cost_amount_check" CHECK ("amount_micros" IS NULL OR "amount_micros" >= 0),
  CONSTRAINT "catalogue_option_ref_cost_method_amount_check" CHECK (
    ("method" = 'manual' AND "amount_micros" IS NOT NULL AND "currency" IS NOT NULL AND "effective_from" IS NOT NULL)
    OR ("method" = 'recipe_derived' AND "amount_micros" IS NULL)
  ),
  CONSTRAINT "catalogue_option_ref_cost_currency_check" CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "catalogue_option_ref_cost_unit_check" CHECK ("unit" IS NULL OR "unit" IN ('each', 'kg', 'g')),
  CONSTRAINT "catalogue_option_ref_cost_tax_basis_check" CHECK ("tax_basis" IS NULL OR "tax_basis" IN ('net', 'gross', 'unconfirmed')),
  CONSTRAINT "catalogue_option_ref_cost_dates_check" CHECK ("effective_to" IS NULL OR "effective_from" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "catalogue_option_ref_cost_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "catalogue_option_ref_cost_tenant_public_id_unique" UNIQUE ("tenant_id", "public_id"),
  CONSTRAINT "catalogue_option_ref_cost_revision_unique" UNIQUE ("tenant_id", "modifier_option_id", "revision"),
  CONSTRAINT "catalogue_option_ref_cost_option_fk" FOREIGN KEY ("tenant_id", "modifier_option_id") REFERENCES "qos"."catalogue_modifier_options"("tenant_id", "id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "catalogue_option_ref_cost_current_unique" ON "qos"."catalogue_modifier_option_reference_cost_policies" USING btree ("tenant_id", "modifier_option_id") WHERE "effective_to" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_option_ref_cost_tenant_id_idx" ON "qos"."catalogue_modifier_option_reference_cost_policies" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "qos"."catalogue_modifier_option_reference_cost_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_modifier_option_reference_cost_policies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."catalogue_modifier_option_reference_cost_policies" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "qos"."catalogue_modifier_option_reference_cost_policies" TO qos_app;--> statement-breakpoint
GRANT UPDATE ("effective_to") ON TABLE "qos"."catalogue_modifier_option_reference_cost_policies" TO qos_app;--> statement-breakpoint
CREATE POLICY "catalogue_modifier_option_ref_cost_policies_tenant_isolation" ON "qos"."catalogue_modifier_option_reference_cost_policies"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);

-- Down script (documentation only; not executed). Run with the admin connection,
-- then delete the idx 59 row from drizzle.__drizzle_migrations if it was recorded:
--   DROP TABLE IF EXISTS "qos"."catalogue_modifier_option_reference_cost_policies";
--   DROP TABLE IF EXISTS "qos"."catalogue_variant_reference_cost_policies";
--   ALTER TABLE "qos"."catalogue_variants" DROP CONSTRAINT IF EXISTS "catalogue_variants_tax_rate_basis_points_check";
--   ALTER TABLE "qos"."catalogue_variants" DROP CONSTRAINT IF EXISTS "catalogue_variants_price_tax_basis_check";
--   ALTER TABLE "qos"."catalogue_variants" DROP COLUMN IF EXISTS "tax_provenance";
--   ALTER TABLE "qos"."catalogue_variants" DROP COLUMN IF EXISTS "tax_rate_basis_points";
--   ALTER TABLE "qos"."catalogue_variants" DROP COLUMN IF EXISTS "price_tax_basis";
