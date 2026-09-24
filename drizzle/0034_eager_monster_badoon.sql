-- QOS-25: Video processing infrastructure
-- This migration adds video processing job queue and extends media_derivative_kind enum
-- Note: Duplicate enum/table creations from migrations 0031 and 0032 have been removed
-- to prevent 42710 "type already exists" errors during test DB setup.

CREATE TYPE "qos"."video_processing_job_status" AS ENUM('queued', 'processing', 'ready', 'failed', 'rejected', 'quarantined');--> statement-breakpoint
ALTER TYPE "qos"."media_derivative_kind" ADD VALUE 'video_playback';--> statement-breakpoint
ALTER TYPE "qos"."media_derivative_kind" ADD VALUE 'video_poster';--> statement-breakpoint
CREATE TABLE "qos"."video_processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"correlation_id" text NOT NULL,
	"source_storage_path" text NOT NULL,
	"status" "qos"."video_processing_job_status" DEFAULT 'queued' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_error_message" text,
	"last_error_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_processing_jobs_correlation_id_unique" UNIQUE("correlation_id")
);
--> statement-breakpoint
ALTER TABLE "qos"."video_processing_jobs" ADD CONSTRAINT "video_processing_jobs_tenant_id_asset_id_catalogue_media_assets_tenant_id_id_fk" FOREIGN KEY ("tenant_id","asset_id") REFERENCES "qos"."catalogue_media_assets"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."video_processing_jobs" ADD CONSTRAINT "video_processing_jobs_tenant_id_product_id_catalogue_products_tenant_id_id_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "qos"."catalogue_products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_processing_jobs_tenant_id_idx" ON "qos"."video_processing_jobs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "video_processing_jobs_status_idx" ON "qos"."video_processing_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "video_processing_jobs_asset_id_idx" ON "qos"."video_processing_jobs" USING btree ("asset_id");--> statement-breakpoint
GRANT ALL ON TABLE qos.video_processing_jobs TO qos_app;--> statement-breakpoint
ALTER TABLE qos.video_processing_jobs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.video_processing_jobs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY video_processing_jobs_tenant_isolation ON qos.video_processing_jobs
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);