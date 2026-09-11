CREATE TYPE "qos"."invitation_delivery_status" AS ENUM('pending', 'failed', 'sent');--> statement-breakpoint
CREATE TYPE "qos"."invitation_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "qos"."provisioning_operation_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "qos"."business_provisioning_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"operator_subject" text NOT NULL,
	"status" "qos"."provisioning_operation_status" DEFAULT 'pending' NOT NULL,
	"tenant_id" uuid,
	"result_snapshot" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_provisioning_operations_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "qos"."staff_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "qos"."staff_role" NOT NULL,
	"status" "qos"."invitation_status" DEFAULT 'pending' NOT NULL,
	"delivery_status" "qos"."invitation_delivery_status" DEFAULT 'pending' NOT NULL,
	"invited_by_operator_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qos"."tenants" ADD COLUMN "supported_locales" text[] DEFAULT '{en,ar}' NOT NULL;--> statement-breakpoint
ALTER TABLE "qos"."tenants" ADD COLUMN "provisioned_by_operator_id" text;--> statement-breakpoint
ALTER TABLE "qos"."business_provisioning_operations" ADD CONSTRAINT "business_provisioning_operations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "qos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."staff_invitations" ADD CONSTRAINT "staff_invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "qos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_provisioning_operations_tenant_id_idx" ON "qos"."business_provisioning_operations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "staff_invitations_tenant_id_idx" ON "qos"."staff_invitations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "staff_invitations_email_idx" ON "qos"."staff_invitations" USING btree ("email");--> statement-breakpoint
GRANT ALL ON TABLE qos.business_provisioning_operations TO qos_migrator;--> statement-breakpoint
GRANT ALL ON TABLE qos.staff_invitations TO qos_app;--> statement-breakpoint
ALTER TABLE qos.staff_invitations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.staff_invitations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY staff_invitations_tenant_isolation ON qos.staff_invitations
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.business_provisioning_operations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.business_provisioning_operations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY business_provisioning_operations_runtime_deny ON qos.business_provisioning_operations
  FOR ALL
  TO qos_app
  USING (false)
  WITH CHECK (false);