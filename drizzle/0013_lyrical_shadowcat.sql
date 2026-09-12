CREATE TYPE "qos"."customer_association_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TABLE "qos"."customer_auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qos"."customer_auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qos"."customer_auth_users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qos"."customer_auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qos"."storefront_customer_associations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"storefront_id" uuid NOT NULL,
	"customer_user_id" text NOT NULL,
	"phone" text,
	"status" "qos"."customer_association_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storefront_customer_associations_tenant_user_unique" UNIQUE("tenant_id","customer_user_id"),
	CONSTRAINT "storefront_customer_associations_storefront_user_unique" UNIQUE("tenant_id","storefront_id","customer_user_id")
);
--> statement-breakpoint
ALTER TABLE "qos"."customer_auth_accounts" ADD CONSTRAINT "customer_auth_accounts_user_id_customer_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "qos"."customer_auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."customer_auth_sessions" ADD CONSTRAINT "customer_auth_sessions_user_id_customer_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "qos"."customer_auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_customer_associations" ADD CONSTRAINT "storefront_customer_associations_customer_user_id_customer_auth_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "qos"."customer_auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."storefront_customer_associations" ADD CONSTRAINT "storefront_customer_associations_tenant_id_storefront_id_storefronts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","storefront_id") REFERENCES "qos"."storefronts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storefront_customer_associations_tenant_id_idx" ON "qos"."storefront_customer_associations" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "qos"."customer_auth_users" ADD CONSTRAINT "customer_auth_users_email_unique" UNIQUE("email");--> statement-breakpoint
ALTER TABLE "qos"."customer_auth_sessions" ADD CONSTRAINT "customer_auth_sessions_token_unique" UNIQUE("token");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.customer_auth_users TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.customer_auth_sessions TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.customer_auth_accounts TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.customer_auth_verifications TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.storefront_customer_associations TO qos_app;--> statement-breakpoint
ALTER TABLE qos.storefront_customer_associations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.storefront_customer_associations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY storefront_customer_associations_tenant_isolation ON qos.storefront_customer_associations
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);