-- MANUAL (Nitesh): snapshot pre-accept approval metadata for admin reject rollback
ALTER TABLE "qos"."catalogue_product_translations" ADD COLUMN IF NOT EXISTS "admin_review_revert_approved_by_subject" text;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_translations" ADD COLUMN IF NOT EXISTS "admin_review_revert_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_translations" ADD COLUMN IF NOT EXISTS "admin_review_revert_approved_translation_version" integer;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_translations" ADD COLUMN IF NOT EXISTS "admin_review_revert_approved_source_translation_version" integer;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_translations" ADD COLUMN IF NOT EXISTS "admin_review_revert_captures_approval_fields" boolean DEFAULT false NOT NULL;
