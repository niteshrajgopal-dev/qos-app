CREATE TABLE "qos"."storefront_basket_merge_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_user_id" text NOT NULL,
	"anonymous_basket_id" uuid NOT NULL,
	"account_basket_id" uuid NOT NULL,
	"operation_id" text NOT NULL,
	"decision" text NOT NULL,
	"payload_hash" text NOT NULL,
	"anonymous_expected_version" integer NOT NULL,
	"account_expected_version" integer NOT NULL,
	"response_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storefront_basket_merge_operations_unique" UNIQUE("tenant_id","customer_user_id","operation_id")
);
--> statement-breakpoint
ALTER TABLE "qos"."storefront_basket_merge_operations" ADD CONSTRAINT "storefront_basket_merge_operations_customer_user_id_customer_auth_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "qos"."customer_auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storefront_basket_merge_operations_tenant_id_idx" ON "qos"."storefront_basket_merge_operations" USING btree ("tenant_id");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.storefront_basket_merge_operations TO qos_app;--> statement-breakpoint
ALTER TABLE qos.storefront_basket_merge_operations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.storefront_basket_merge_operations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY storefront_basket_merge_operations_tenant_isolation ON qos.storefront_basket_merge_operations
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);