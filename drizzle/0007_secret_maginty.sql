CREATE TABLE "qos"."catalogue_variant_location_price_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"amount_minor" integer NOT NULL,
	"central_price_version_at_override" integer NOT NULL,
	"created_by_subject" text NOT NULL,
	"updated_by_subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_variant_location_price_overrides_unique" UNIQUE("tenant_id","variant_id","location_id","currency")
);
--> statement-breakpoint
CREATE TABLE "qos"."catalogue_variant_location_price_reset_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"previous_amount_minor" integer NOT NULL,
	"reset_by_subject" text NOT NULL,
	"reset_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variant_prices" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variant_location_price_overrides" ADD CONSTRAINT "catalogue_variant_location_price_overrides_tenant_id_variant_id_catalogue_variants_tenant_id_id_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "qos"."catalogue_variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variant_location_price_overrides" ADD CONSTRAINT "catalogue_variant_location_price_overrides_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "qos"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variant_location_price_reset_audits" ADD CONSTRAINT "catalogue_variant_location_price_reset_audits_tenant_id_variant_id_catalogue_variants_tenant_id_id_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "qos"."catalogue_variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_variant_location_price_reset_audits" ADD CONSTRAINT "catalogue_variant_location_price_reset_audits_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "qos"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalogue_variant_location_price_overrides_tenant_id_idx" ON "qos"."catalogue_variant_location_price_overrides" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "catalogue_variant_location_price_reset_audits_tenant_id_idx" ON "qos"."catalogue_variant_location_price_reset_audits" USING btree ("tenant_id");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.catalogue_variant_location_price_overrides TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.catalogue_variant_location_price_reset_audits TO qos_app;--> statement-breakpoint
ALTER TABLE qos.catalogue_variant_location_price_overrides ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_variant_location_price_overrides FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_variant_location_price_overrides_tenant_isolation ON qos.catalogue_variant_location_price_overrides
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.catalogue_variant_location_price_reset_audits ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_variant_location_price_reset_audits FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_variant_location_price_reset_audits_tenant_isolation ON qos.catalogue_variant_location_price_reset_audits
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);