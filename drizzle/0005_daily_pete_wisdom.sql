CREATE TABLE "qos"."catalogue_menu_live_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"source_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_menu_live_revisions_menu_unique" UNIQUE("tenant_id","menu_id")
);
--> statement-breakpoint
CREATE TABLE "qos"."catalogue_menu_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_menu_locations_unique" UNIQUE("tenant_id","menu_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "qos"."catalogue_menu_section_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_menu_section_products_unique" UNIQUE("tenant_id","section_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "qos"."catalogue_menu_section_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"translation_version" integer DEFAULT 1 NOT NULL,
	"approval_status" "qos"."translation_approval_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_menu_section_translations_unique" UNIQUE("tenant_id","section_id","locale")
);
--> statement-breakpoint
CREATE TABLE "qos"."catalogue_menu_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"internal_name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_menu_sections_tenant_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "catalogue_menu_sections_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "qos"."catalogue_menu_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"translation_version" integer DEFAULT 1 NOT NULL,
	"approval_status" "qos"."translation_approval_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_menu_translations_unique" UNIQUE("tenant_id","menu_id","locale")
);
--> statement-breakpoint
CREATE TABLE "qos"."catalogue_menus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"internal_name" text NOT NULL,
	"status" "qos"."product_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published_version" integer,
	"provenance" "qos"."data_provenance" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_menus_tenant_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "catalogue_menus_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "qos"."catalogue_menu_live_revisions" ADD CONSTRAINT "catalogue_menu_live_revisions_tenant_id_menu_id_catalogue_menus_tenant_id_id_fk" FOREIGN KEY ("tenant_id","menu_id") REFERENCES "qos"."catalogue_menus"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_menu_locations" ADD CONSTRAINT "catalogue_menu_locations_tenant_id_menu_id_catalogue_menus_tenant_id_id_fk" FOREIGN KEY ("tenant_id","menu_id") REFERENCES "qos"."catalogue_menus"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_menu_locations" ADD CONSTRAINT "catalogue_menu_locations_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "qos"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_menu_section_products" ADD CONSTRAINT "catalogue_menu_section_products_tenant_id_section_id_catalogue_menu_sections_tenant_id_id_fk" FOREIGN KEY ("tenant_id","section_id") REFERENCES "qos"."catalogue_menu_sections"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_menu_section_products" ADD CONSTRAINT "catalogue_menu_section_products_tenant_id_product_id_catalogue_products_tenant_id_id_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "qos"."catalogue_products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_menu_section_translations" ADD CONSTRAINT "catalogue_menu_section_translations_tenant_id_section_id_catalogue_menu_sections_tenant_id_id_fk" FOREIGN KEY ("tenant_id","section_id") REFERENCES "qos"."catalogue_menu_sections"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_menu_sections" ADD CONSTRAINT "catalogue_menu_sections_tenant_id_menu_id_catalogue_menus_tenant_id_id_fk" FOREIGN KEY ("tenant_id","menu_id") REFERENCES "qos"."catalogue_menus"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_menu_translations" ADD CONSTRAINT "catalogue_menu_translations_tenant_id_menu_id_catalogue_menus_tenant_id_id_fk" FOREIGN KEY ("tenant_id","menu_id") REFERENCES "qos"."catalogue_menus"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_menus" ADD CONSTRAINT "catalogue_menus_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "qos"."brands"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalogue_menu_live_revisions_tenant_id_idx" ON "qos"."catalogue_menu_live_revisions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "catalogue_menu_locations_tenant_id_idx" ON "qos"."catalogue_menu_locations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "catalogue_menu_section_products_tenant_id_idx" ON "qos"."catalogue_menu_section_products" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "catalogue_menu_section_translations_tenant_id_idx" ON "qos"."catalogue_menu_section_translations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "catalogue_menu_sections_tenant_id_idx" ON "qos"."catalogue_menu_sections" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "catalogue_menu_translations_tenant_id_idx" ON "qos"."catalogue_menu_translations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "catalogue_menus_tenant_id_idx" ON "qos"."catalogue_menus" USING btree ("tenant_id");--> statement-breakpoint
GRANT ALL ON TABLE qos.catalogue_menus TO qos_app;--> statement-breakpoint
GRANT ALL ON TABLE qos.catalogue_menu_translations TO qos_app;--> statement-breakpoint
GRANT ALL ON TABLE qos.catalogue_menu_locations TO qos_app;--> statement-breakpoint
GRANT ALL ON TABLE qos.catalogue_menu_sections TO qos_app;--> statement-breakpoint
GRANT ALL ON TABLE qos.catalogue_menu_section_translations TO qos_app;--> statement-breakpoint
GRANT ALL ON TABLE qos.catalogue_menu_section_products TO qos_app;--> statement-breakpoint
GRANT ALL ON TABLE qos.catalogue_menu_live_revisions TO qos_app;--> statement-breakpoint
ALTER TABLE qos.catalogue_menus ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_menus FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_menus_tenant_isolation ON qos.catalogue_menus
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.catalogue_menu_translations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_menu_translations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_menu_translations_tenant_isolation ON qos.catalogue_menu_translations
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.catalogue_menu_locations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_menu_locations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_menu_locations_tenant_isolation ON qos.catalogue_menu_locations
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.catalogue_menu_sections ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_menu_sections FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_menu_sections_tenant_isolation ON qos.catalogue_menu_sections
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.catalogue_menu_section_translations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_menu_section_translations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_menu_section_translations_tenant_isolation ON qos.catalogue_menu_section_translations
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.catalogue_menu_section_products ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_menu_section_products FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_menu_section_products_tenant_isolation ON qos.catalogue_menu_section_products
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.catalogue_menu_live_revisions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_menu_live_revisions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_menu_live_revisions_tenant_isolation ON qos.catalogue_menu_live_revisions
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);