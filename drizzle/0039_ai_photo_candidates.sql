-- QOS-140: AI-generated product photo candidates reuse catalogue_media_assets.
-- Provenance marks the asset as AI-generated; generation_metadata keeps the
-- private model/prompt/review record (never exposed on public media routes).
ALTER TYPE "qos"."data_provenance" ADD VALUE IF NOT EXISTS 'ai_generated';--> statement-breakpoint
ALTER TABLE "qos"."catalogue_media_assets" ADD COLUMN IF NOT EXISTS "generation_metadata" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_media_assets_tenant_provenance_created_idx" ON "qos"."catalogue_media_assets" USING btree ("tenant_id","source_provenance","created_at");
