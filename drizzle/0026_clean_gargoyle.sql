CREATE TABLE "qos"."catalogue_variant_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_variant_translations_unique" UNIQUE("tenant_id","variant_id","locale")
);
--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variants" ADD COLUMN "status" "qos"."product_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variants" ADD COLUMN "sku" text;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variants" ADD COLUMN "barcode" text;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variant_translations" ADD CONSTRAINT "catalogue_variant_translations_tenant_id_variant_id_catalogue_variants_tenant_id_id_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "qos"."catalogue_variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalogue_variant_translations_tenant_id_idx" ON "qos"."catalogue_variant_translations" USING btree ("tenant_id");--> statement-breakpoint
GRANT ALL ON TABLE qos.catalogue_variant_translations TO qos_app;--> statement-breakpoint
ALTER TABLE qos.catalogue_variant_translations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_variant_translations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_variant_translations_tenant_isolation ON qos.catalogue_variant_translations
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);