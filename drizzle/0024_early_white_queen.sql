CREATE TYPE "qos"."audit_actor_class" AS ENUM('staff_administrator', 'staff_user', 'operator', 'system');--> statement-breakpoint
CREATE TABLE "qos"."tenant_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid,
	"actor_subject" text NOT NULL,
	"actor_class" "qos"."audit_actor_class" NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_public_id" text NOT NULL,
	"entity_version" integer,
	"correlation_id" uuid NOT NULL,
	"change_summary" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qos"."tenant_audit_events" ADD CONSTRAINT "tenant_audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "qos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."tenant_audit_events" ADD CONSTRAINT "tenant_audit_events_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "qos"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_audit_events_tenant_id_idx" ON "qos"."tenant_audit_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_audit_events_tenant_occurred_at_idx" ON "qos"."tenant_audit_events" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "tenant_audit_events_tenant_entity_idx" ON "qos"."tenant_audit_events" USING btree ("tenant_id","entity_type","entity_public_id");--> statement-breakpoint
CREATE INDEX "tenant_audit_events_tenant_action_idx" ON "qos"."tenant_audit_events" USING btree ("tenant_id","action");--> statement-breakpoint
ALTER TABLE "qos"."staff_invitations" ADD CONSTRAINT "staff_invitations_tenant_id_id_unique" UNIQUE("tenant_id","id");