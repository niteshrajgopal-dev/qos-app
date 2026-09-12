CREATE TYPE "qos"."media_asset_status" AS ENUM('pending_upload', 'uploaded', 'processing', 'approved', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "qos"."media_derivative_kind" AS ENUM('thumbnail', 'display');--> statement-breakpoint
CREATE TYPE "qos"."media_upload_grant_status" AS ENUM('pending', 'used', 'expired');--> statement-breakpoint
CREATE TABLE "qos"."catalogue_media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"status" "qos"."media_asset_status" DEFAULT 'pending_upload' NOT NULL,
	"content_type" text,
	"alt_text_en" text,
	"alt_text_ar" text,
	"source_provenance" "qos"."data_provenance" DEFAULT 'operator_entered' NOT NULL,
	"failure_reason" text,
	"approved_by_subject" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_media_assets_tenant_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "catalogue_media_assets_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "qos"."catalogue_media_derivatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"derivative_kind" "qos"."media_derivative_kind" NOT NULL,
	"public_derivative_id" text NOT NULL,
	"storage_path" text NOT NULL,
	"content_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_media_derivatives_public_id_unique" UNIQUE("public_derivative_id"),
	CONSTRAINT "catalogue_media_derivatives_asset_kind_unique" UNIQUE("tenant_id","asset_id","derivative_kind")
);
--> statement-breakpoint
CREATE TABLE "qos"."catalogue_media_upload_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"grant_token" text NOT NULL,
	"private_storage_path" text NOT NULL,
	"expected_byte_size" integer NOT NULL,
	"expected_content_type" text NOT NULL,
	"status" "qos"."media_upload_grant_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "catalogue_media_upload_grants_token_unique" UNIQUE("grant_token")
);
--> statement-breakpoint
ALTER TABLE "qos"."catalogue_media_assets" ADD CONSTRAINT "catalogue_media_assets_tenant_id_product_id_catalogue_products_tenant_id_id_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "qos"."catalogue_products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_media_derivatives" ADD CONSTRAINT "catalogue_media_derivatives_tenant_id_asset_id_catalogue_media_assets_tenant_id_id_fk" FOREIGN KEY ("tenant_id","asset_id") REFERENCES "qos"."catalogue_media_assets"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_media_upload_grants" ADD CONSTRAINT "catalogue_media_upload_grants_tenant_id_asset_id_catalogue_media_assets_tenant_id_id_fk" FOREIGN KEY ("tenant_id","asset_id") REFERENCES "qos"."catalogue_media_assets"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalogue_media_assets_tenant_id_idx" ON "qos"."catalogue_media_assets" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "catalogue_media_derivatives_tenant_id_idx" ON "qos"."catalogue_media_derivatives" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "catalogue_media_upload_grants_tenant_id_idx" ON "qos"."catalogue_media_upload_grants" USING btree ("tenant_id");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.catalogue_media_assets TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.catalogue_media_derivatives TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.catalogue_media_upload_grants TO qos_app;--> statement-breakpoint
ALTER TABLE qos.catalogue_media_assets ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_media_assets FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_media_assets_tenant_isolation ON qos.catalogue_media_assets
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.catalogue_media_derivatives ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_media_derivatives FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_media_derivatives_tenant_isolation ON qos.catalogue_media_derivatives
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.catalogue_media_upload_grants ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_media_upload_grants FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_media_upload_grants_tenant_isolation ON qos.catalogue_media_upload_grants
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);