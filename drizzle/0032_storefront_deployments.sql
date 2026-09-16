CREATE TYPE "qos"."storefront_deployment_lifecycle_status" AS ENUM('provisioning', 'active', 'inactive');--> statement-breakpoint
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
ALTER TABLE "qos"."storefront_deployments" ADD CONSTRAINT "storefront_deployments_tenant_id_storefront_id_storefronts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","storefront_id") REFERENCES "qos"."storefronts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storefront_deployments_tenant_id_idx" ON "qos"."storefront_deployments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "storefront_deployments_storefront_id_idx" ON "qos"."storefront_deployments" USING btree ("tenant_id","storefront_id");--> statement-breakpoint
GRANT ALL ON TABLE qos.storefront_deployments TO qos_app;--> statement-breakpoint
ALTER TABLE qos.storefront_deployments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.storefront_deployments FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY storefront_deployments_tenant_isolation ON qos.storefront_deployments
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY storefront_deployments_public_resolution ON qos.storefront_deployments
  FOR SELECT
  TO qos_app
  USING (coalesce(nullif(current_setting('qos.current_tenant_id', true), ''), '') = '');
