CREATE TYPE "qos"."menu_public_link_status" AS ENUM('active', 'paused');--> statement-breakpoint
CREATE TABLE "qos"."catalogue_menu_public_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"status" "qos"."menu_public_link_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_menu_public_links_menu_location_unique" UNIQUE("tenant_id","menu_id","location_id"),
	CONSTRAINT "catalogue_menu_public_links_public_key_unique" UNIQUE("public_key")
);
--> statement-breakpoint
ALTER TABLE "qos"."catalogue_menu_public_links" ADD CONSTRAINT "catalogue_menu_public_links_tenant_id_menu_id_catalogue_menus_tenant_id_id_fk" FOREIGN KEY ("tenant_id","menu_id") REFERENCES "qos"."catalogue_menus"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_menu_public_links" ADD CONSTRAINT "catalogue_menu_public_links_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "qos"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalogue_menu_public_links_tenant_id_idx" ON "qos"."catalogue_menu_public_links" USING btree ("tenant_id");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.catalogue_menu_public_links TO qos_app;--> statement-breakpoint
ALTER TABLE qos.catalogue_menu_public_links ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_menu_public_links FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_menu_public_links_tenant_isolation ON qos.catalogue_menu_public_links
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);