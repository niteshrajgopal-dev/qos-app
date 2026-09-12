CREATE TYPE "qos"."checkout_payment_attempt_status" AS ENUM('pending', 'provider_handoff', 'unknown', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "qos"."checkout_payment_provider_mode" AS ENUM('sandbox', 'fixture');--> statement-breakpoint
CREATE TABLE "qos"."storefront_checkout_payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_user_id" text NOT NULL,
	"quote_id" uuid NOT NULL,
	"basket_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"status" "qos"."checkout_payment_attempt_status" DEFAULT 'pending' NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"provider_mode" "qos"."checkout_payment_provider_mode" NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"quote_snapshot" jsonb NOT NULL,
	"provider_reference" text,
	"provider_idempotency_key" text NOT NULL,
	"return_url" text NOT NULL,
	"cancel_url" text NOT NULL,
	"handoff_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storefront_checkout_payment_attempts_tenant_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "storefront_checkout_payment_attempts_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "qos"."storefront_checkout_payment_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_user_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"payment_attempt_id" uuid NOT NULL,
	"response_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storefront_checkout_payment_operations_unique" UNIQUE("tenant_id","customer_user_id","operation_id")
);
--> statement-breakpoint
ALTER TABLE "qos"."storefront_checkout_payment_attempts" ADD CONSTRAINT "storefront_checkout_payment_attempts_customer_user_id_customer_auth_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "qos"."customer_auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_checkout_payment_attempts" ADD CONSTRAINT "storefront_checkout_payment_attempts_tenant_id_quote_id_storefront_checkout_quotes_tenant_id_id_fk" FOREIGN KEY ("tenant_id","quote_id") REFERENCES "qos"."storefront_checkout_quotes"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_checkout_payment_attempts" ADD CONSTRAINT "storefront_checkout_payment_attempts_tenant_id_basket_id_storefront_customer_baskets_tenant_id_id_fk" FOREIGN KEY ("tenant_id","basket_id") REFERENCES "qos"."storefront_customer_baskets"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_checkout_payment_operations" ADD CONSTRAINT "storefront_checkout_payment_operations_customer_user_id_customer_auth_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "qos"."customer_auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_checkout_payment_operations" ADD CONSTRAINT "storefront_checkout_payment_operations_tenant_id_payment_attempt_id_storefront_checkout_payment_attempts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","payment_attempt_id") REFERENCES "qos"."storefront_checkout_payment_attempts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storefront_checkout_payment_attempts_tenant_id_idx" ON "qos"."storefront_checkout_payment_attempts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "storefront_checkout_payment_attempts_quote_id_idx" ON "qos"."storefront_checkout_payment_attempts" USING btree ("tenant_id","quote_id");--> statement-breakpoint
CREATE INDEX "storefront_checkout_payment_operations_tenant_id_idx" ON "qos"."storefront_checkout_payment_operations" USING btree ("tenant_id");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.storefront_checkout_payment_attempts TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.storefront_checkout_payment_operations TO qos_app;--> statement-breakpoint
ALTER TABLE qos.storefront_checkout_payment_attempts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.storefront_checkout_payment_attempts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY storefront_checkout_payment_attempts_tenant_isolation ON qos.storefront_checkout_payment_attempts
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.storefront_checkout_payment_operations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.storefront_checkout_payment_operations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY storefront_checkout_payment_operations_tenant_isolation ON qos.storefront_checkout_payment_operations
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);