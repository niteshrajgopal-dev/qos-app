CREATE SCHEMA "qos";
--> statement-breakpoint
CREATE TYPE "qos"."business_profile" AS ENUM('hospitality', 'generic_retail');--> statement-breakpoint
CREATE TYPE "qos"."location_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "qos"."membership_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "qos"."staff_role" AS ENUM('administrator', 'user');--> statement-breakpoint
CREATE TYPE "qos"."tenant_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TABLE "qos"."brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_tenant_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "brands_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "qos"."locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text NOT NULL,
	"status" "qos"."location_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_tenant_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "locations_tenant_slug_unique" UNIQUE("tenant_id","slug"),
	CONSTRAINT "locations_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "qos"."organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_tenant_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "organizations_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "qos"."staff_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_identities_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "qos"."staff_location_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_membership_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_location_scopes_membership_location_unique" UNIQUE("staff_membership_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "qos"."staff_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_identity_id" uuid NOT NULL,
	"role" "qos"."staff_role" NOT NULL,
	"status" "qos"."membership_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_memberships_tenant_staff_unique" UNIQUE("tenant_id","staff_identity_id"),
	CONSTRAINT "staff_memberships_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "qos"."tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "qos"."tenant_status" DEFAULT 'active' NOT NULL,
	"business_profile" "qos"."business_profile" NOT NULL,
	"base_currency" char(3) NOT NULL,
	"default_locale" text NOT NULL,
	"default_timezone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
ALTER TABLE "qos"."brands" ADD CONSTRAINT "brands_tenant_id_organization_id_organizations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","organization_id") REFERENCES "qos"."organizations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."locations" ADD CONSTRAINT "locations_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "qos"."brands"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."organizations" ADD CONSTRAINT "organizations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "qos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."staff_location_scopes" ADD CONSTRAINT "staff_location_scopes_tenant_id_staff_membership_id_staff_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","staff_membership_id") REFERENCES "qos"."staff_memberships"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."staff_location_scopes" ADD CONSTRAINT "staff_location_scopes_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "qos"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."staff_memberships" ADD CONSTRAINT "staff_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "qos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."staff_memberships" ADD CONSTRAINT "staff_memberships_staff_identity_id_staff_identities_id_fk" FOREIGN KEY ("staff_identity_id") REFERENCES "qos"."staff_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brands_tenant_id_idx" ON "qos"."brands" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "locations_tenant_id_idx" ON "qos"."locations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "organizations_tenant_id_idx" ON "qos"."organizations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "staff_location_scopes_tenant_id_idx" ON "qos"."staff_location_scopes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "staff_memberships_tenant_id_idx" ON "qos"."staff_memberships" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenants_status_idx" ON "qos"."tenants" USING btree ("status");--> statement-breakpoint
DO $$ BEGIN
  CREATE ROLE qos_app NOLOGIN;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE ROLE qos_migrator NOLOGIN BYPASSRLS;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA qos TO qos_app, qos_migrator;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA qos TO qos_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA qos TO qos_app;--> statement-breakpoint
GRANT ALL ON SCHEMA qos TO qos_migrator;--> statement-breakpoint
GRANT ALL ON ALL TABLES IN SCHEMA qos TO qos_migrator;--> statement-breakpoint
GRANT ALL ON ALL SEQUENCES IN SCHEMA qos TO qos_migrator;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA qos GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO qos_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA qos GRANT USAGE, SELECT ON SEQUENCES TO qos_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA qos GRANT ALL ON TABLES TO qos_migrator;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA qos GRANT ALL ON SEQUENCES TO qos_migrator;--> statement-breakpoint
ALTER TABLE qos.tenants ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.tenants FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenants_tenant_isolation ON qos.tenants
  FOR ALL
  USING (id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.organizations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.organizations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY organizations_tenant_isolation ON qos.organizations
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.brands ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.brands FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY brands_tenant_isolation ON qos.brands
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.locations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.locations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY locations_tenant_isolation ON qos.locations
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.staff_memberships ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.staff_memberships FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY staff_memberships_tenant_isolation ON qos.staff_memberships
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.staff_location_scopes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.staff_location_scopes FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY staff_location_scopes_tenant_isolation ON qos.staff_location_scopes
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.staff_identities ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.staff_identities FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY staff_identities_tenant_isolation ON qos.staff_identities
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM qos.staff_memberships sm
      WHERE sm.staff_identity_id = staff_identities.id
        AND sm.tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM qos.staff_memberships sm
      WHERE sm.staff_identity_id = staff_identities.id
        AND sm.tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid
    )
  );