TRUNCATE TABLE qos.catalogue_menu_live_revisions;--> statement-breakpoint
CREATE TYPE "qos"."menu_publish_operation_status" AS ENUM('completed', 'partial', 'failed');--> statement-breakpoint
CREATE TABLE "qos"."catalogue_menu_publish_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"operation_public_id" text NOT NULL,
	"publisher_subject" text NOT NULL,
	"source_version" integer NOT NULL,
	"target_location_ids" jsonb NOT NULL,
	"status" "qos"."menu_publish_operation_status" NOT NULL,
	"location_results" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_menu_publish_operations_unique" UNIQUE("tenant_id","operation_public_id")
);
--> statement-breakpoint
ALTER TABLE "qos"."catalogue_menu_live_revisions" DROP CONSTRAINT "catalogue_menu_live_revisions_menu_unique";--> statement-breakpoint
ALTER TABLE "qos"."catalogue_menu_live_revisions" ADD COLUMN "location_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_menu_live_revisions" ADD COLUMN "published_by_subject" text NOT NULL;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_menu_publish_operations" ADD CONSTRAINT "catalogue_menu_publish_operations_tenant_id_menu_id_catalogue_menus_tenant_id_id_fk" FOREIGN KEY ("tenant_id","menu_id") REFERENCES "qos"."catalogue_menus"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalogue_menu_publish_operations_tenant_id_idx" ON "qos"."catalogue_menu_publish_operations" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "qos"."catalogue_menu_live_revisions" ADD CONSTRAINT "catalogue_menu_live_revisions_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "qos"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_menu_live_revisions" ADD CONSTRAINT "catalogue_menu_live_revisions_menu_location_unique" UNIQUE("tenant_id","menu_id","location_id");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.catalogue_menu_publish_operations TO qos_app;--> statement-breakpoint
ALTER TABLE qos.catalogue_menu_publish_operations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.catalogue_menu_publish_operations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalogue_menu_publish_operations_tenant_isolation ON qos.catalogue_menu_publish_operations
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);