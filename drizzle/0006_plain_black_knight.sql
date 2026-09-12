ALTER TABLE "qos"."catalogue_product_translations" ADD COLUMN "provenance" "qos"."data_provenance" DEFAULT 'operator_entered' NOT NULL;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_translations" ADD COLUMN "approved_by_subject" text;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_translations" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_translations" ADD COLUMN "approved_translation_version" integer;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_translations" ADD COLUMN "approved_source_translation_version" integer;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_translations" ADD COLUMN "last_approved_by_subject" text;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_translations" ADD COLUMN "last_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_translations" ADD COLUMN "last_approved_translation_version" integer;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_translations" ADD COLUMN "last_approved_source_translation_version" integer;