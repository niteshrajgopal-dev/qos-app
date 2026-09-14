CREATE TABLE "qos"."catalogue_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"internal_name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "qos"."product_status" DEFAULT 'active' NOT NULL,
	"provenance" "qos"."data_provenance" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_categories_tenant_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "catalogue_categories_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "qos"."catalogue_category_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_category_translations_unique" UNIQUE("tenant_id","category_id","locale")
);
--> statement-breakpoint
CREATE TABLE "qos"."catalogue_product_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_product_categories_unique" UNIQUE("tenant_id","product_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "qos"."catalogue_category_translations" ADD CONSTRAINT "catalogue_category_translations_tenant_id_category_id_catalogue_categories_tenant_id_id_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "qos"."catalogue_categories"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_categories" ADD CONSTRAINT "catalogue_product_categories_tenant_id_product_id_catalogue_products_tenant_id_id_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "qos"."catalogue_products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_categories" ADD CONSTRAINT "catalogue_product_categories_tenant_id_category_id_catalogue_categories_tenant_id_id_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "qos"."catalogue_categories"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalogue_categories_tenant_id_idx" ON "qos"."catalogue_categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "catalogue_category_translations_tenant_id_idx" ON "qos"."catalogue_category_translations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "catalogue_product_categories_tenant_id_idx" ON "qos"."catalogue_product_categories" USING btree ("tenant_id");--> statement-breakpoint
GRANT ALL ON TABLE qos.catalogue_categories TO qos_app;--> statement-breakpoint
GRANT ALL ON TABLE qos.catalogue_category_translations TO qos_app;--> statement-breakpoint
GRANT ALL ON TABLE qos.catalogue_product_categories TO qos_app;--> statement-breakpoint
ALTER TABLE qos.catalogue_categories ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_categories FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_categories_tenant_isolation ON qos.catalogue_categories
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.catalogue_category_translations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_category_translations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_category_translations_tenant_isolation ON qos.catalogue_category_translations
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.catalogue_product_categories ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_product_categories FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_product_categories_tenant_isolation ON qos.catalogue_product_categories
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);
