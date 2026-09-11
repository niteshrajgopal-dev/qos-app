CREATE TYPE "qos"."translation_approval_status" AS ENUM('draft', 'approved');--> statement-breakpoint
ALTER TABLE "qos"."catalogue_products" ALTER COLUMN "status" SET DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_translations" ADD COLUMN "translation_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_translations" ADD COLUMN "approval_status" "qos"."translation_approval_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_products" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_products" ADD COLUMN "sku" text;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_products" ADD COLUMN "barcode" text;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_products" ADD COLUMN "primary_media_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_products" ADD COLUMN "nutrition_calories" integer;