CREATE TYPE "qos"."anonymous_basket_status" AS ENUM('active', 'expired');--> statement-breakpoint
CREATE TYPE "qos"."anonymous_session_status" AS ENUM('active', 'expired');--> statement-breakpoint
CREATE TABLE "qos"."storefront_anonymous_basket_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"basket_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"product_public_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_amount_minor" integer NOT NULL,
	"unit_currency" char(3) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storefront_anonymous_basket_lines_tenant_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "storefront_anonymous_basket_lines_product_unique" UNIQUE("tenant_id","basket_id","product_public_id")
);
--> statement-breakpoint
CREATE TABLE "qos"."storefront_anonymous_basket_mutations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"basket_id" uuid NOT NULL,
	"mutation_id" text NOT NULL,
	"response_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storefront_anonymous_basket_mutations_unique" UNIQUE("tenant_id","basket_id","mutation_id")
);
--> statement-breakpoint
CREATE TABLE "qos"."storefront_anonymous_baskets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "qos"."anonymous_basket_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storefront_anonymous_baskets_tenant_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "storefront_anonymous_baskets_session_unique" UNIQUE("tenant_id","session_id"),
	CONSTRAINT "storefront_anonymous_baskets_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "qos"."storefront_anonymous_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"storefront_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"session_token_hash" text NOT NULL,
	"csrf_token" text NOT NULL,
	"locale" text NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "qos"."anonymous_session_status" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storefront_anonymous_sessions_token_hash_unique" UNIQUE("session_token_hash"),
	CONSTRAINT "storefront_anonymous_sessions_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "qos"."storefront_anonymous_basket_lines" ADD CONSTRAINT "storefront_anonymous_basket_lines_tenant_id_basket_id_storefront_anonymous_baskets_tenant_id_id_fk" FOREIGN KEY ("tenant_id","basket_id") REFERENCES "qos"."storefront_anonymous_baskets"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_anonymous_basket_mutations" ADD CONSTRAINT "storefront_anonymous_basket_mutations_tenant_id_basket_id_storefront_anonymous_baskets_tenant_id_id_fk" FOREIGN KEY ("tenant_id","basket_id") REFERENCES "qos"."storefront_anonymous_baskets"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_anonymous_baskets" ADD CONSTRAINT "storefront_anonymous_baskets_tenant_id_session_id_storefront_anonymous_sessions_tenant_id_id_fk" FOREIGN KEY ("tenant_id","session_id") REFERENCES "qos"."storefront_anonymous_sessions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_anonymous_sessions" ADD CONSTRAINT "storefront_anonymous_sessions_tenant_id_storefront_id_storefronts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","storefront_id") REFERENCES "qos"."storefronts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_anonymous_sessions" ADD CONSTRAINT "storefront_anonymous_sessions_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "qos"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_anonymous_sessions" ADD CONSTRAINT "storefront_anonymous_sessions_tenant_id_menu_id_catalogue_menus_tenant_id_id_fk" FOREIGN KEY ("tenant_id","menu_id") REFERENCES "qos"."catalogue_menus"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storefront_anonymous_basket_lines_tenant_id_idx" ON "qos"."storefront_anonymous_basket_lines" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "storefront_anonymous_basket_mutations_tenant_id_idx" ON "qos"."storefront_anonymous_basket_mutations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "storefront_anonymous_baskets_tenant_id_idx" ON "qos"."storefront_anonymous_baskets" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "storefront_anonymous_sessions_tenant_id_idx" ON "qos"."storefront_anonymous_sessions" USING btree ("tenant_id");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.storefront_anonymous_sessions TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.storefront_anonymous_baskets TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.storefront_anonymous_basket_lines TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.storefront_anonymous_basket_mutations TO qos_app;--> statement-breakpoint
ALTER TABLE qos.storefront_anonymous_sessions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.storefront_anonymous_sessions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY storefront_anonymous_sessions_tenant_isolation ON qos.storefront_anonymous_sessions
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.storefront_anonymous_baskets ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.storefront_anonymous_baskets FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY storefront_anonymous_baskets_tenant_isolation ON qos.storefront_anonymous_baskets
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.storefront_anonymous_basket_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.storefront_anonymous_basket_lines FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY storefront_anonymous_basket_lines_tenant_isolation ON qos.storefront_anonymous_basket_lines
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.storefront_anonymous_basket_mutations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.storefront_anonymous_basket_mutations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY storefront_anonymous_basket_mutations_tenant_isolation ON qos.storefront_anonymous_basket_mutations
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);