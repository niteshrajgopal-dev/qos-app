CREATE TABLE "qos"."storefront_checkout_quote_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_user_id" text NOT NULL,
	"basket_id" uuid NOT NULL,
	"operation_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"quote_id" uuid NOT NULL,
	"response_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storefront_checkout_quote_operations_unique" UNIQUE("tenant_id","customer_user_id","operation_id")
);
--> statement-breakpoint
CREATE TABLE "qos"."storefront_checkout_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_user_id" text NOT NULL,
	"basket_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"basket_version" integer NOT NULL,
	"basket_public_id" text NOT NULL,
	"pricing_policy_version" integer NOT NULL,
	"coupon_code" text,
	"locale" text NOT NULL,
	"currency" char(3) NOT NULL,
	"is_test" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storefront_checkout_quotes_tenant_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "storefront_checkout_quotes_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "qos"."storefront_checkout_quote_operations" ADD CONSTRAINT "storefront_checkout_quote_operations_customer_user_id_customer_auth_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "qos"."customer_auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_checkout_quote_operations" ADD CONSTRAINT "storefront_checkout_quote_operations_tenant_id_quote_id_storefront_checkout_quotes_tenant_id_id_fk" FOREIGN KEY ("tenant_id","quote_id") REFERENCES "qos"."storefront_checkout_quotes"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_checkout_quotes" ADD CONSTRAINT "storefront_checkout_quotes_customer_user_id_customer_auth_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "qos"."customer_auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_checkout_quotes" ADD CONSTRAINT "storefront_checkout_quotes_tenant_id_basket_id_storefront_customer_baskets_tenant_id_id_fk" FOREIGN KEY ("tenant_id","basket_id") REFERENCES "qos"."storefront_customer_baskets"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storefront_checkout_quote_operations_tenant_id_idx" ON "qos"."storefront_checkout_quote_operations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "storefront_checkout_quotes_tenant_id_idx" ON "qos"."storefront_checkout_quotes" USING btree ("tenant_id");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.storefront_checkout_quotes TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.storefront_checkout_quote_operations TO qos_app;--> statement-breakpoint
ALTER TABLE qos.storefront_checkout_quotes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.storefront_checkout_quotes FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY storefront_checkout_quotes_tenant_isolation ON qos.storefront_checkout_quotes
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.storefront_checkout_quote_operations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.storefront_checkout_quote_operations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY storefront_checkout_quote_operations_tenant_isolation ON qos.storefront_checkout_quote_operations
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);