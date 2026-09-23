CREATE TYPE "qos"."storefront_deployment_lifecycle_status" AS ENUM('provisioning', 'active', 'inactive');--> statement-breakpoint
CREATE TYPE "qos"."video_processing_job_status" AS ENUM('queued', 'processing', 'ready', 'failed', 'rejected', 'quarantined');--> statement-breakpoint
ALTER TYPE "qos"."media_derivative_kind" ADD VALUE 'video_playback';--> statement-breakpoint
ALTER TYPE "qos"."media_derivative_kind" ADD VALUE 'video_poster';--> statement-breakpoint
CREATE TABLE "qos"."catalogue_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"internal_name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "qos"."product_status" DEFAULT 'active' NOT NULL,
	"provenance" "qos"."data_provenance" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_categories_tenant_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "catalogue_categories_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "qos"."catalogue_category_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_category_translations_unique" UNIQUE("tenant_id","category_id","locale")
);
--> statement-breakpoint
CREATE TABLE "qos"."catalogue_product_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_product_categories_unique" UNIQUE("tenant_id","product_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "qos"."storefront_deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"storefront_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"environment" text NOT NULL,
	"region" text NOT NULL,
	"container_app_name" text NOT NULL,
	"lifecycle_status" "qos"."storefront_deployment_lifecycle_status" DEFAULT 'provisioning' NOT NULL,
	"application_version" text NOT NULL,
	"image_repository" text DEFAULT 'qos-storefront' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storefront_deployments_tenant_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "storefront_deployments_container_app_name_unique" UNIQUE("container_app_name"),
	CONSTRAINT "storefront_deployments_storefront_environment_unique" UNIQUE("tenant_id","storefront_id","environment"),
	CONSTRAINT "storefront_deployments_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
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
ALTER TABLE "qos"."catalogue_category_translations" ADD CONSTRAINT "catalogue_category_translations_tenant_id_category_id_catalogue_categories_tenant_id_id_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "qos"."catalogue_categories"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_categories" ADD CONSTRAINT "catalogue_product_categories_tenant_id_product_id_catalogue_products_tenant_id_id_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "qos"."catalogue_products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_product_categories" ADD CONSTRAINT "catalogue_product_categories_tenant_id_category_id_catalogue_categories_tenant_id_id_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "qos"."catalogue_categories"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_deployments" ADD CONSTRAINT "storefront_deployments_tenant_id_storefront_id_storefronts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","storefront_id") REFERENCES "qos"."storefronts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."video_processing_jobs" ADD CONSTRAINT "video_processing_jobs_tenant_id_asset_id_catalogue_media_assets_tenant_id_id_fk" FOREIGN KEY ("tenant_id","asset_id") REFERENCES "qos"."catalogue_media_assets"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."video_processing_jobs" ADD CONSTRAINT "video_processing_jobs_tenant_id_product_id_catalogue_products_tenant_id_id_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "qos"."catalogue_products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalogue_categories_tenant_id_idx" ON "qos"."catalogue_categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "catalogue_category_translations_tenant_id_idx" ON "qos"."catalogue_category_translations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "catalogue_product_categories_tenant_id_idx" ON "qos"."catalogue_product_categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "storefront_deployments_tenant_id_idx" ON "qos"."storefront_deployments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "storefront_deployments_storefront_id_idx" ON "qos"."storefront_deployments" USING btree ("tenant_id","storefront_id");--> statement-breakpoint
CREATE INDEX "video_processing_jobs_tenant_id_idx" ON "qos"."video_processing_jobs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "video_processing_jobs_status_idx" ON "qos"."video_processing_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "video_processing_jobs_asset_id_idx" ON "qos"."video_processing_jobs" USING btree ("asset_id");