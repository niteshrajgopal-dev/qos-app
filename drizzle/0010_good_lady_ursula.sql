CREATE TYPE "qos"."storefront_domain_lifecycle_status" AS ENUM('provisioning', 'active', 'inactive');--> statement-breakpoint
CREATE TYPE "qos"."storefront_domain_type" AS ENUM('platform_subdomain', 'custom_domain');--> statement-breakpoint
CREATE TYPE "qos"."storefront_domain_verification_status" AS ENUM('pending', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "qos"."storefront_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TABLE "qos"."storefront_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"storefront_id" uuid NOT NULL,
	"hostname" text NOT NULL,
	"domain_type" "qos"."storefront_domain_type" NOT NULL,
	"verification_status" "qos"."storefront_domain_verification_status" DEFAULT 'pending' NOT NULL,
	"lifecycle_status" "qos"."storefront_domain_lifecycle_status" DEFAULT 'provisioning' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storefront_domains_hostname_unique" UNIQUE("hostname"),
	CONSTRAINT "storefront_domains_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "qos"."storefront_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"storefront_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storefront_locations_unique" UNIQUE("tenant_id","storefront_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "qos"."storefront_published_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"storefront_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storefront_published_collections_location_unique" UNIQUE("tenant_id","storefront_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "qos"."storefront_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"storefront_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"release_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"published_by_subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storefront_releases_tenant_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "storefront_releases_storefront_version_unique" UNIQUE("tenant_id","storefront_id","release_version"),
	CONSTRAINT "storefront_releases_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "qos"."storefronts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"internal_name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "qos"."storefront_status" DEFAULT 'draft' NOT NULL,
	"default_locale" text NOT NULL,
	"supported_locales" text[] NOT NULL,
	"draft_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"active_release_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storefronts_tenant_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "storefronts_tenant_slug_unique" UNIQUE("tenant_id","slug"),
	CONSTRAINT "storefronts_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "qos"."storefront_domains" ADD CONSTRAINT "storefront_domains_tenant_id_storefront_id_storefronts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","storefront_id") REFERENCES "qos"."storefronts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_locations" ADD CONSTRAINT "storefront_locations_tenant_id_storefront_id_storefronts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","storefront_id") REFERENCES "qos"."storefronts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_locations" ADD CONSTRAINT "storefront_locations_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "qos"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_published_collections" ADD CONSTRAINT "storefront_published_collections_tenant_id_storefront_id_storefronts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","storefront_id") REFERENCES "qos"."storefronts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_published_collections" ADD CONSTRAINT "storefront_published_collections_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "qos"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_published_collections" ADD CONSTRAINT "storefront_published_collections_tenant_id_menu_id_catalogue_menus_tenant_id_id_fk" FOREIGN KEY ("tenant_id","menu_id") REFERENCES "qos"."catalogue_menus"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_releases" ADD CONSTRAINT "storefront_releases_tenant_id_storefront_id_storefronts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","storefront_id") REFERENCES "qos"."storefronts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefronts" ADD CONSTRAINT "storefronts_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "qos"."brands"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storefront_domains_tenant_id_idx" ON "qos"."storefront_domains" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "storefront_locations_tenant_id_idx" ON "qos"."storefront_locations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "storefront_published_collections_tenant_id_idx" ON "qos"."storefront_published_collections" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "storefront_releases_tenant_id_idx" ON "qos"."storefront_releases" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "storefronts_tenant_id_idx" ON "qos"."storefronts" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "qos"."storefronts" ADD CONSTRAINT "storefronts_tenant_id_active_release_id_storefront_releases_tenant_id_id_fk" FOREIGN KEY ("tenant_id","active_release_id") REFERENCES "qos"."storefront_releases"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.storefronts TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.storefront_releases TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.storefront_domains TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.storefront_locations TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.storefront_published_collections TO qos_app;--> statement-breakpoint
ALTER TABLE qos.storefronts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.storefronts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY storefronts_tenant_isolation ON qos.storefronts
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.storefront_releases ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.storefront_releases FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY storefront_releases_tenant_isolation ON qos.storefront_releases
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.storefront_domains ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.storefront_domains FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY storefront_domains_tenant_isolation ON qos.storefront_domains
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.storefront_locations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.storefront_locations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY storefront_locations_tenant_isolation ON qos.storefront_locations
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.storefront_published_collections ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.storefront_published_collections FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY storefront_published_collections_tenant_isolation ON qos.storefront_published_collections
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);