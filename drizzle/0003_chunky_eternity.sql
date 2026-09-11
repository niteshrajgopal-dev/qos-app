CREATE TYPE "qos"."data_provenance" AS ENUM('synthetic_fixture', 'operator_entered', 'imported');--> statement-breakpoint
CREATE TYPE "qos"."external_menu_provider" AS ENUM('finedine');--> statement-breakpoint
CREATE TYPE "qos"."product_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TABLE "qos"."catalogue_modifier_group_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"modifier_group_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_modifier_group_translations_unique" UNIQUE("tenant_id","modifier_group_id","locale")
);
--> statement-breakpoint
CREATE TABLE "qos"."catalogue_modifier_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"internal_name" text NOT NULL,
	"min_selections" integer DEFAULT 0 NOT NULL,
	"max_selections" integer DEFAULT 1 NOT NULL,
	"provenance" "qos"."data_provenance" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_modifier_groups_tenant_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "catalogue_modifier_groups_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "qos"."catalogue_modifier_option_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"modifier_option_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_modifier_option_translations_unique" UNIQUE("tenant_id","modifier_option_id","locale")
);
--> statement-breakpoint
CREATE TABLE "qos"."catalogue_modifier_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"modifier_group_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"price_minor" integer DEFAULT 0 NOT NULL,
	"currency" char(3) DEFAULT 'AED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_modifier_options_tenant_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "catalogue_modifier_options_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "qos"."catalogue_product_modifier_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"modifier_group_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_product_modifier_groups_unique" UNIQUE("tenant_id","product_id","modifier_group_id")
);
--> statement-breakpoint
CREATE TABLE "qos"."catalogue_product_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_product_translations_unique" UNIQUE("tenant_id","product_id","locale")
);
--> statement-breakpoint
CREATE TABLE "qos"."catalogue_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"internal_name" text NOT NULL,
	"status" "qos"."product_status" DEFAULT 'active' NOT NULL,
	"provenance" "qos"."data_provenance" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_products_tenant_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "catalogue_products_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "qos"."catalogue_variant_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"amount_minor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_variant_prices_unique" UNIQUE("tenant_id","variant_id","currency")
);
--> statement-breakpoint
CREATE TABLE "qos"."catalogue_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_variants_tenant_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "catalogue_variants_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "qos"."location_external_menu_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"provider" "qos"."external_menu_provider" NOT NULL,
	"external_menu_id" text NOT NULL,
	"source_url" text NOT NULL,
	"provenance_note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_external_menu_sources_unique" UNIQUE("tenant_id","location_id","provider")
);
--> statement-breakpoint
ALTER TABLE "qos"."catalogue_modifier_group_translations" ADD CONSTRAINT "catalogue_modifier_group_translations_tenant_id_modifier_group_id_catalogue_modifier_groups_tenant_id_id_fk" FOREIGN KEY ("tenant_id","modifier_group_id") REFERENCES "qos"."catalogue_modifier_groups"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_modifier_option_translations" ADD CONSTRAINT "catalogue_modifier_option_translations_tenant_id_modifier_option_id_catalogue_modifier_options_tenant_id_id_fk" FOREIGN KEY ("tenant_id","modifier_option_id") REFERENCES "qos"."catalogue_modifier_options"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_modifier_options" ADD CONSTRAINT "catalogue_modifier_options_tenant_id_modifier_group_id_catalogue_modifier_groups_tenant_id_id_fk" FOREIGN KEY ("tenant_id","modifier_group_id") REFERENCES "qos"."catalogue_modifier_groups"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_modifier_groups" ADD CONSTRAINT "catalogue_product_modifier_groups_tenant_id_product_id_catalogue_products_tenant_id_id_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "qos"."catalogue_products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_modifier_groups" ADD CONSTRAINT "catalogue_product_modifier_groups_tenant_id_modifier_group_id_catalogue_modifier_groups_tenant_id_id_fk" FOREIGN KEY ("tenant_id","modifier_group_id") REFERENCES "qos"."catalogue_modifier_groups"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_translations" ADD CONSTRAINT "catalogue_product_translations_tenant_id_product_id_catalogue_products_tenant_id_id_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "qos"."catalogue_products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_products" ADD CONSTRAINT "catalogue_products_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "qos"."brands"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variant_prices" ADD CONSTRAINT "catalogue_variant_prices_tenant_id_variant_id_catalogue_variants_tenant_id_id_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "qos"."catalogue_variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variants" ADD CONSTRAINT "catalogue_variants_tenant_id_product_id_catalogue_products_tenant_id_id_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "qos"."catalogue_products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."location_external_menu_sources" ADD CONSTRAINT "location_external_menu_sources_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "qos"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalogue_modifier_group_translations_tenant_id_idx" ON "qos"."catalogue_modifier_group_translations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "catalogue_modifier_groups_tenant_id_idx" ON "qos"."catalogue_modifier_groups" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "catalogue_modifier_option_translations_tenant_id_idx" ON "qos"."catalogue_modifier_option_translations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "catalogue_modifier_options_tenant_id_idx" ON "qos"."catalogue_modifier_options" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "catalogue_product_modifier_groups_tenant_id_idx" ON "qos"."catalogue_product_modifier_groups" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "catalogue_product_translations_tenant_id_idx" ON "qos"."catalogue_product_translations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "catalogue_products_tenant_id_idx" ON "qos"."catalogue_products" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "catalogue_variant_prices_tenant_id_idx" ON "qos"."catalogue_variant_prices" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "catalogue_variants_tenant_id_idx" ON "qos"."catalogue_variants" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "location_external_menu_sources_tenant_id_idx" ON "qos"."location_external_menu_sources" USING btree ("tenant_id");--> statement-breakpoint
GRANT ALL ON TABLE qos.location_external_menu_sources TO qos_app;--> statement-breakpoint
GRANT ALL ON TABLE qos.catalogue_products TO qos_app;--> statement-breakpoint
GRANT ALL ON TABLE qos.catalogue_product_translations TO qos_app;--> statement-breakpoint
GRANT ALL ON TABLE qos.catalogue_variants TO qos_app;--> statement-breakpoint
GRANT ALL ON TABLE qos.catalogue_variant_prices TO qos_app;--> statement-breakpoint
GRANT ALL ON TABLE qos.catalogue_modifier_groups TO qos_app;--> statement-breakpoint
GRANT ALL ON TABLE qos.catalogue_modifier_group_translations TO qos_app;--> statement-breakpoint
GRANT ALL ON TABLE qos.catalogue_modifier_options TO qos_app;--> statement-breakpoint
GRANT ALL ON TABLE qos.catalogue_modifier_option_translations TO qos_app;--> statement-breakpoint
GRANT ALL ON TABLE qos.catalogue_product_modifier_groups TO qos_app;--> statement-breakpoint
ALTER TABLE qos.location_external_menu_sources ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.location_external_menu_sources FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY location_external_menu_sources_tenant_isolation ON qos.location_external_menu_sources
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.catalogue_products ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_products FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_products_tenant_isolation ON qos.catalogue_products
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.catalogue_product_translations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_product_translations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_product_translations_tenant_isolation ON qos.catalogue_product_translations
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.catalogue_variants ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_variants FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_variants_tenant_isolation ON qos.catalogue_variants
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.catalogue_variant_prices ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_variant_prices FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_variant_prices_tenant_isolation ON qos.catalogue_variant_prices
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.catalogue_modifier_groups ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_modifier_groups FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_modifier_groups_tenant_isolation ON qos.catalogue_modifier_groups
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.catalogue_modifier_group_translations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_modifier_group_translations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_modifier_group_translations_tenant_isolation ON qos.catalogue_modifier_group_translations
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.catalogue_modifier_options ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_modifier_options FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_modifier_options_tenant_isolation ON qos.catalogue_modifier_options
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.catalogue_modifier_option_translations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_modifier_option_translations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_modifier_option_translations_tenant_isolation ON qos.catalogue_modifier_option_translations
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.catalogue_product_modifier_groups ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_product_modifier_groups FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_product_modifier_groups_tenant_isolation ON qos.catalogue_product_modifier_groups
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);