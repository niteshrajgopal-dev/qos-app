CREATE TYPE "qos"."checkout_provider_event_processing_status" AS ENUM('received', 'processed', 'rejected', 'ignored');--> statement-breakpoint
ALTER TYPE "qos"."checkout_payment_attempt_status" ADD VALUE 'succeeded' BEFORE 'cancelled';--> statement-breakpoint
ALTER TYPE "qos"."checkout_payment_attempt_status" ADD VALUE 'failed' BEFORE 'cancelled';--> statement-breakpoint
CREATE TABLE "qos"."storefront_checkout_provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"livemode" boolean DEFAULT false NOT NULL,
	"payment_attempt_id" uuid,
	"payload_summary" jsonb NOT NULL,
	"processing_status" "qos"."checkout_provider_event_processing_status" DEFAULT 'received' NOT NULL,
	"rejection_reason" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "storefront_checkout_provider_events_provider_event_unique" UNIQUE("provider","provider_event_id")
);
--> statement-breakpoint
ALTER TABLE "qos"."storefront_checkout_payment_attempts" ADD COLUMN "outcome_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "qos"."storefront_checkout_payment_attempts" ADD COLUMN "reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "qos"."storefront_checkout_payment_attempts" ADD COLUMN "last_provider_event_id" text;--> statement-breakpoint
ALTER TABLE "qos"."storefront_checkout_provider_events" ADD CONSTRAINT "storefront_checkout_provider_events_tenant_id_payment_attempt_id_storefront_checkout_payment_attempts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","payment_attempt_id") REFERENCES "qos"."storefront_checkout_payment_attempts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storefront_checkout_provider_events_tenant_id_idx" ON "qos"."storefront_checkout_provider_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "storefront_checkout_provider_events_payment_attempt_idx" ON "qos"."storefront_checkout_provider_events" USING btree ("tenant_id","payment_attempt_id");--> statement-breakpoint
CREATE INDEX "storefront_checkout_payment_attempts_customer_public_id_idx" ON "qos"."storefront_checkout_payment_attempts" USING btree ("tenant_id","customer_user_id","public_id");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.storefront_checkout_provider_events TO qos_app;--> statement-breakpoint
ALTER TABLE qos.storefront_checkout_provider_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.storefront_checkout_provider_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY storefront_checkout_provider_events_tenant_isolation ON qos.storefront_checkout_provider_events
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);