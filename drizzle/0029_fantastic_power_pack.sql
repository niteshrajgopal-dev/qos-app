CREATE TYPE "qos"."catalogue_import_operation_status" AS ENUM('preview_ready', 'applied', 'failed');--> statement-breakpoint
CREATE TABLE "qos"."catalogue_import_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"operation_public_id" text NOT NULL,
	"staff_subject" text NOT NULL,
	"connection_key" text NOT NULL,
	"file_name" text NOT NULL,
	"file_fingerprint" text NOT NULL,
	"column_mapping" jsonb NOT NULL,
	"preview_payload" jsonb NOT NULL,
	"preview_hash" text NOT NULL,
	"status" "qos"."catalogue_import_operation_status" NOT NULL,
	"apply_report" jsonb,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "catalogue_import_operations_public_id_unique" UNIQUE("tenant_id","operation_public_id"),
	CONSTRAINT "catalogue_import_operations_idempotency_unique" UNIQUE("tenant_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "qos"."catalogue_import_source_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_key" text NOT NULL,
	"source_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_import_source_links_unique" UNIQUE("tenant_id","connection_key","source_id")
);
--> statement-breakpoint
ALTER TABLE "qos"."catalogue_import_source_links" ADD CONSTRAINT "catalogue_import_source_links_tenant_id_product_id_catalogue_products_tenant_id_id_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "qos"."catalogue_products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalogue_import_operations_tenant_id_idx" ON "qos"."catalogue_import_operations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "catalogue_import_source_links_tenant_id_idx" ON "qos"."catalogue_import_source_links" USING btree ("tenant_id");--> statement-breakpoint
GRANT ALL ON TABLE qos.catalogue_import_operations TO qos_app;--> statement-breakpoint
GRANT ALL ON TABLE qos.catalogue_import_source_links TO qos_app;--> statement-breakpoint
ALTER TABLE qos.catalogue_import_operations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_import_operations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_import_operations_tenant_isolation ON qos.catalogue_import_operations
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.catalogue_import_source_links ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_import_source_links FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_import_source_links_tenant_isolation ON qos.catalogue_import_source_links
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);