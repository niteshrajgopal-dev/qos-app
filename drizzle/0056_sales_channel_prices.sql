-- MANUAL (Nitesh): QOS-213 sales-channel identities and channel price lists.
-- Apply after 0054 (QOS-212) and 0055 (QOS-194) when those have merged; this
-- file depends on neither and is additive only (five new tenant tables).
-- No tenant gets a channel from this migration: channels are created by an
-- administrator. A channel is not a location and is never used as a warehouse.

CREATE TABLE IF NOT EXISTS "qos"."sales_channels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "public_id" text NOT NULL,
  "code" text NOT NULL,
  "display_name" text NOT NULL,
  "kind" text DEFAULT 'aggregator' NOT NULL,
  "workbook_slot" text,
  "status" text DEFAULT 'active' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sales_channels_tenant_public_id_unique" UNIQUE ("tenant_id","public_id"),
  CONSTRAINT "sales_channels_tenant_id_id_unique" UNIQUE ("tenant_id","id"),
  CONSTRAINT "sales_channels_tenant_code_unique" UNIQUE ("tenant_id","code"),
  CONSTRAINT "sales_channels_public_id_format" CHECK ("public_id" ~ '^schan_[a-z0-9_-]+$'),
  CONSTRAINT "sales_channels_code_format" CHECK ("code" ~ '^[a-z0-9_]+$' AND char_length("code") <= 64),
  CONSTRAINT "sales_channels_display_name_len" CHECK (char_length(btrim("display_name")) BETWEEN 1 AND 120),
  CONSTRAINT "sales_channels_kind_check" CHECK ("kind" IN ('aggregator', 'other')),
  CONSTRAINT "sales_channels_workbook_slot_check" CHECK ("workbook_slot" IS NULL OR "workbook_slot" IN ('aggregator_1', 'aggregator_2', 'aggregator_3')),
  CONSTRAINT "sales_channels_status_check" CHECK ("status" IN ('active', 'archived')),
  CONSTRAINT "sales_channels_version_check" CHECK ("version" >= 1),
  CONSTRAINT "sales_channels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "qos"."tenants"("id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_channels_tenant_workbook_slot_unique" ON "qos"."sales_channels" USING btree ("tenant_id","workbook_slot") WHERE "workbook_slot" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_channels_tenant_id_idx" ON "qos"."sales_channels" USING btree ("tenant_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qos"."catalogue_variant_channel_prices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "variant_id" uuid NOT NULL,
  "channel_id" uuid NOT NULL,
  "currency" char(3) NOT NULL,
  "amount_minor" integer NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "central_price_version_at_override" integer NOT NULL,
  "created_by_subject" text NOT NULL,
  "updated_by_subject" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "catalogue_variant_channel_prices_unique" UNIQUE ("tenant_id","variant_id","channel_id","currency"),
  CONSTRAINT "catalogue_variant_channel_prices_amount_check" CHECK ("amount_minor" >= 0),
  CONSTRAINT "catalogue_variant_channel_prices_version_check" CHECK ("version" >= 1),
  CONSTRAINT "catalogue_variant_channel_prices_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "qos"."catalogue_variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "catalogue_variant_channel_prices_channel_fk" FOREIGN KEY ("tenant_id","channel_id") REFERENCES "qos"."sales_channels"("tenant_id","id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_variant_channel_prices_tenant_id_idx" ON "qos"."catalogue_variant_channel_prices" USING btree ("tenant_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qos"."catalogue_modifier_option_channel_prices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "modifier_option_id" uuid NOT NULL,
  "channel_id" uuid NOT NULL,
  "currency" char(3) NOT NULL,
  "amount_minor" integer NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_by_subject" text NOT NULL,
  "updated_by_subject" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "catalogue_modifier_option_channel_prices_unique" UNIQUE ("tenant_id","modifier_option_id","channel_id","currency"),
  CONSTRAINT "catalogue_modifier_option_channel_prices_amount_check" CHECK ("amount_minor" >= 0),
  CONSTRAINT "catalogue_modifier_option_channel_prices_version_check" CHECK ("version" >= 1),
  CONSTRAINT "catalogue_modifier_option_channel_prices_option_fk" FOREIGN KEY ("tenant_id","modifier_option_id") REFERENCES "qos"."catalogue_modifier_options"("tenant_id","id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "catalogue_modifier_option_channel_prices_channel_fk" FOREIGN KEY ("tenant_id","channel_id") REFERENCES "qos"."sales_channels"("tenant_id","id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_modifier_option_channel_prices_tenant_id_idx" ON "qos"."catalogue_modifier_option_channel_prices" USING btree ("tenant_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qos"."catalogue_variant_channel_price_reset_audits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "variant_id" uuid NOT NULL,
  "channel_id" uuid NOT NULL,
  "currency" char(3) NOT NULL,
  "previous_amount_minor" integer NOT NULL,
  "reset_by_subject" text NOT NULL,
  "reset_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "catalogue_variant_channel_price_reset_audits_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "qos"."catalogue_variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "catalogue_variant_channel_price_reset_audits_channel_fk" FOREIGN KEY ("tenant_id","channel_id") REFERENCES "qos"."sales_channels"("tenant_id","id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_variant_channel_price_reset_audits_tenant_id_idx" ON "qos"."catalogue_variant_channel_price_reset_audits" USING btree ("tenant_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qos"."catalogue_option_channel_price_reset_audits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "modifier_option_id" uuid NOT NULL,
  "channel_id" uuid NOT NULL,
  "currency" char(3) NOT NULL,
  "previous_amount_minor" integer NOT NULL,
  "reset_by_subject" text NOT NULL,
  "reset_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "catalogue_option_channel_price_reset_audits_option_fk" FOREIGN KEY ("tenant_id","modifier_option_id") REFERENCES "qos"."catalogue_modifier_options"("tenant_id","id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "catalogue_option_channel_price_reset_audits_channel_fk" FOREIGN KEY ("tenant_id","channel_id") REFERENCES "qos"."sales_channels"("tenant_id","id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_option_channel_price_reset_audits_tenant_id_idx" ON "qos"."catalogue_option_channel_price_reset_audits" USING btree ("tenant_id");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "qos"."sales_channels" TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "qos"."catalogue_variant_channel_prices" TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "qos"."catalogue_modifier_option_channel_prices" TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "qos"."catalogue_variant_channel_price_reset_audits" TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "qos"."catalogue_option_channel_price_reset_audits" TO qos_app;--> statement-breakpoint
ALTER TABLE "qos"."sales_channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."sales_channels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sales_channels_tenant_isolation" ON "qos"."sales_channels"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variant_channel_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variant_channel_prices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "catalogue_variant_channel_prices_tenant_isolation" ON "qos"."catalogue_variant_channel_prices"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "qos"."catalogue_modifier_option_channel_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_modifier_option_channel_prices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "catalogue_modifier_option_channel_prices_tenant_isolation" ON "qos"."catalogue_modifier_option_channel_prices"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variant_channel_price_reset_audits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variant_channel_price_reset_audits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "catalogue_variant_channel_price_reset_audits_tenant_isolation" ON "qos"."catalogue_variant_channel_price_reset_audits"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "qos"."catalogue_option_channel_price_reset_audits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_option_channel_price_reset_audits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "catalogue_option_channel_price_reset_audits_tenant_isolation" ON "qos"."catalogue_option_channel_price_reset_audits"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);

-- Down script (documentation only; NOT executed by the migrator). Run as the
-- migration owner, then delete the idx 56 row from drizzle.__drizzle_migrations
-- and the journal entry. Dropping a table also drops its policy and grants.
--
-- DROP TABLE IF EXISTS "qos"."catalogue_option_channel_price_reset_audits";
-- DROP TABLE IF EXISTS "qos"."catalogue_variant_channel_price_reset_audits";
-- DROP TABLE IF EXISTS "qos"."catalogue_modifier_option_channel_prices";
-- DROP TABLE IF EXISTS "qos"."catalogue_variant_channel_prices";
-- DROP TABLE IF EXISTS "qos"."sales_channels";
