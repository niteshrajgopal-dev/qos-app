CREATE TABLE "qos"."staff_auth_accounts" (
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
CREATE TABLE "qos"."staff_auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "qos"."staff_auth_users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_auth_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "qos"."staff_auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qos"."staff_invitation_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_invitation_locations_unique" UNIQUE("invitation_id","location_id")
);
--> statement-breakpoint
ALTER TABLE "qos"."staff_invitations" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "qos"."staff_invitations" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "qos"."staff_invitations" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "qos"."staff_invitations" ADD COLUMN "accepted_by_staff_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "qos"."staff_auth_accounts" ADD CONSTRAINT "staff_auth_accounts_user_id_staff_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "qos"."staff_auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."staff_auth_sessions" ADD CONSTRAINT "staff_auth_sessions_user_id_staff_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "qos"."staff_auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."staff_invitations" ADD CONSTRAINT "staff_invitations_tenant_id_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "qos"."staff_invitation_locations" ADD CONSTRAINT "staff_invitation_locations_tenant_id_invitation_id_staff_invitations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","invitation_id") REFERENCES "qos"."staff_invitations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."staff_invitation_locations" ADD CONSTRAINT "staff_invitation_locations_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "qos"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_invitation_locations_tenant_id_idx" ON "qos"."staff_invitation_locations" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "qos"."staff_invitations" ADD CONSTRAINT "staff_invitations_accepted_by_staff_identity_id_staff_identities_id_fk" FOREIGN KEY ("accepted_by_staff_identity_id") REFERENCES "qos"."staff_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."staff_invitations" ADD CONSTRAINT "staff_invitations_token_hash_unique" UNIQUE("token_hash");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.staff_auth_users TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.staff_auth_sessions TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.staff_auth_accounts TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.staff_auth_verifications TO qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON qos.staff_invitation_locations TO qos_app;--> statement-breakpoint
ALTER TABLE qos.staff_invitation_locations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.staff_invitation_locations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY staff_invitation_locations_tenant_isolation ON qos.staff_invitation_locations
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);