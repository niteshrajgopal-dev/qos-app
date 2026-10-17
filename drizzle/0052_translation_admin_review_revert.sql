-- MANUAL (Nitesh): snapshot pre-accept catalogue text for admin approval reject rollback
ALTER TABLE "qos"."catalogue_product_translations" ADD COLUMN IF NOT EXISTS "admin_review_revert_display_name" text;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_translations" ADD COLUMN IF NOT EXISTS "admin_review_revert_description" text;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_translations" ADD COLUMN IF NOT EXISTS "admin_review_revert_provenance" "qos"."data_provenance";--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_translations" ADD COLUMN IF NOT EXISTS "admin_review_revert_approval_status" "qos"."translation_approval_status";--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_translations" ADD COLUMN IF NOT EXISTS "last_approved_display_name" text;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_translations" ADD COLUMN IF NOT EXISTS "last_approved_description" text;--> statement-breakpoint
