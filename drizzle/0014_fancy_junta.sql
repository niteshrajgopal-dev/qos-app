CREATE TABLE "qos"."storefront_customer_basket_lines" (
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
	CONSTRAINT "storefront_customer_basket_lines_tenant_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "storefront_customer_basket_lines_product_unique" UNIQUE("tenant_id","basket_id","product_public_id")
);
--> statement-breakpoint
CREATE TABLE "qos"."storefront_customer_basket_mutations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"basket_id" uuid NOT NULL,
	"mutation_id" text NOT NULL,
	"response_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storefront_customer_basket_mutations_unique" UNIQUE("tenant_id","basket_id","mutation_id")
);
--> statement-breakpoint
CREATE TABLE "qos"."storefront_customer_baskets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"storefront_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"customer_user_id" text NOT NULL,
	"public_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "qos"."anonymous_basket_status" DEFAULT 'active' NOT NULL,
	"locale" text NOT NULL,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storefront_customer_baskets_tenant_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "storefront_customer_baskets_context_unique" UNIQUE("tenant_id","customer_user_id","storefront_id","location_id"),
	CONSTRAINT "storefront_customer_baskets_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "qos"."storefront_customer_basket_lines" ADD CONSTRAINT "storefront_customer_basket_lines_tenant_id_basket_id_storefront_customer_baskets_tenant_id_id_fk" FOREIGN KEY ("tenant_id","basket_id") REFERENCES "qos"."storefront_customer_baskets"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_customer_basket_mutations" ADD CONSTRAINT "storefront_customer_basket_mutations_tenant_id_basket_id_storefront_customer_baskets_tenant_id_id_fk" FOREIGN KEY ("tenant_id","basket_id") REFERENCES "qos"."storefront_customer_baskets"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_customer_baskets" ADD CONSTRAINT "storefront_customer_baskets_customer_user_id_customer_auth_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "qos"."customer_auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_customer_baskets" ADD CONSTRAINT "storefront_customer_baskets_tenant_id_storefront_id_storefronts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","storefront_id") REFERENCES "qos"."storefronts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_customer_baskets" ADD CONSTRAINT "storefront_customer_baskets_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "qos"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_customer_baskets" ADD CONSTRAINT "storefront_customer_baskets_tenant_id_menu_id_catalogue_menus_tenant_id_id_fk" FOREIGN KEY ("tenant_id","menu_id") REFERENCES "qos"."catalogue_menus"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storefront_customer_basket_lines_tenant_id_idx" ON "qos"."storefront_customer_basket_lines" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "storefront_customer_basket_mutations_tenant_id_idx" ON "qos"."storefront_customer_basket_mutations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "storefront_customer_baskets_tenant_id_idx" ON "qos"."storefront_customer_baskets" USING btree ("tenant_id");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.storefront_customer_baskets TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.storefront_customer_basket_lines TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.storefront_customer_basket_mutations TO qos_app;--> statement-breakpoint
ALTER TABLE qos.storefront_customer_baskets ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.storefront_customer_baskets FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY storefront_customer_baskets_tenant_isolation ON qos.storefront_customer_baskets
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.storefront_customer_basket_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.storefront_customer_basket_lines FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY storefront_customer_basket_lines_tenant_isolation ON qos.storefront_customer_basket_lines
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.storefront_customer_basket_mutations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.storefront_customer_basket_mutations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY storefront_customer_basket_mutations_tenant_isolation ON qos.storefront_customer_basket_mutations
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);