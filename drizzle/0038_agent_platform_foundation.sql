-- QOS-139: minimal agent platform foundation (forward-only).
-- Platform-scoped provider connection + encrypted credentials, platform-approved
-- tenant agent bindings, and tenant-scoped agent runs.

CREATE TYPE "qos"."agent_provider" AS ENUM('hyperagent');--> statement-breakpoint
CREATE TYPE "qos"."agent_provider_connection_status" AS ENUM('disconnected', 'connected', 'needs_reauth', 'error');--> statement-breakpoint
CREATE TYPE "qos"."agent_capability" AS ENUM('menu_manager');--> statement-breakpoint
CREATE TYPE "qos"."agent_run_status" AS ENUM('queued', 'running', 'awaiting_approval', 'completed', 'failed');--> statement-breakpoint

CREATE TABLE "qos"."agent_provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "qos"."agent_provider" NOT NULL,
	"status" "qos"."agent_provider_connection_status" DEFAULT 'disconnected' NOT NULL,
	"server_url" text NOT NULL,
	"account_label" text,
	"connected_by_subject" text,
	"connected_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_provider_connections_provider_unique" UNIQUE("provider"),
	CONSTRAINT "agent_provider_connections_server_url_https" CHECK (server_url ~ '^https://'),
	CONSTRAINT "agent_provider_connections_error_code_length" CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 100)
);
--> statement-breakpoint
CREATE TABLE "qos"."agent_provider_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"ciphertext" text NOT NULL,
	"key_fingerprint" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_provider_credentials_connection_unique" UNIQUE("connection_id")
);
--> statement-breakpoint
ALTER TABLE "qos"."agent_provider_credentials" ADD CONSTRAINT "agent_provider_credentials_connection_id_agent_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "qos"."agent_provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "qos"."tenant_agent_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"capability" "qos"."agent_capability" NOT NULL,
	"provider" "qos"."agent_provider" NOT NULL,
	"provider_agent_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"approved_by_subject" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enabled_changed_by_subject" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_agent_bindings_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "tenant_agent_bindings_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "tenant_agent_bindings_capability_unique" UNIQUE("tenant_id","capability"),
	CONSTRAINT "tenant_agent_bindings_provider_agent_id_format" CHECK (provider_agent_id ~ '^[A-Za-z0-9_-]{1,128}$')
);
--> statement-breakpoint
ALTER TABLE "qos"."tenant_agent_bindings" ADD CONSTRAINT "tenant_agent_bindings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "qos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_agent_bindings_tenant_id_idx" ON "qos"."tenant_agent_bindings" USING btree ("tenant_id");--> statement-breakpoint

CREATE TABLE "qos"."agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"binding_id" uuid NOT NULL,
	"capability" "qos"."agent_capability" NOT NULL,
	"provider" "qos"."agent_provider" NOT NULL,
	"provider_agent_id" text NOT NULL,
	"provider_thread_id" text,
	"status" "qos"."agent_run_status" DEFAULT 'queued' NOT NULL,
	"subject_type" text NOT NULL,
	"subject_public_id" text NOT NULL,
	"subject_version" integer,
	"requested_by_subject" text NOT NULL,
	"requested_by_actor_class" "qos"."audit_actor_class" NOT NULL,
	"idempotency_key" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"request_summary" jsonb NOT NULL,
	"result" jsonb,
	"raw_result_excerpt" text,
	"failure_code" text,
	"failure_message" text,
	"poll_lease_owner" text,
	"poll_lease_expires_at" timestamp with time zone,
	"last_polled_at" timestamp with time zone,
	"next_poll_at" timestamp with time zone,
	"poll_count" integer DEFAULT 0 NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_runs_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "agent_runs_idempotency_unique" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "agent_runs_thread_required" CHECK (status IN ('queued', 'failed') OR provider_thread_id IS NOT NULL),
	CONSTRAINT "agent_runs_raw_result_excerpt_length" CHECK (raw_result_excerpt IS NULL OR char_length(raw_result_excerpt) <= 16384),
	CONSTRAINT "agent_runs_failure_message_length" CHECK (failure_message IS NULL OR char_length(failure_message) <= 2000),
	CONSTRAINT "agent_runs_idempotency_key_length" CHECK (char_length(idempotency_key) BETWEEN 8 AND 200)
);
--> statement-breakpoint
ALTER TABLE "qos"."agent_runs" ADD CONSTRAINT "agent_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "qos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."agent_runs" ADD CONSTRAINT "agent_runs_tenant_id_binding_id_tenant_agent_bindings_tenant_id_id_fk" FOREIGN KEY ("tenant_id","binding_id") REFERENCES "qos"."tenant_agent_bindings"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_one_active_per_subject" ON "qos"."agent_runs" USING btree ("tenant_id","capability","subject_type","subject_public_id") WHERE status in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "agent_runs_tenant_subject_idx" ON "qos"."agent_runs" USING btree ("tenant_id","subject_type","subject_public_id","created_at");--> statement-breakpoint

-- Provider connection: status is readable by the runtime; writes need the
-- agent platform admin setting (operator CLI) or credential access (runtime
-- marking the connection as needing re-auth).
-- Default privileges (0000) grant DELETE on new tables; runs, bindings and the
-- connection record are history and must not be deletable by the runtime.
REVOKE DELETE, TRUNCATE ON TABLE qos.agent_provider_connections, qos.tenant_agent_bindings, qos.agent_runs FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE qos.agent_provider_connections TO qos_app;--> statement-breakpoint
ALTER TABLE qos.agent_provider_connections ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.agent_provider_connections FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY agent_provider_connections_status_read ON qos.agent_provider_connections
  FOR SELECT
  TO qos_app
  USING (true);--> statement-breakpoint
CREATE POLICY agent_provider_connections_platform_insert ON qos.agent_provider_connections
  FOR INSERT
  TO qos_app
  WITH CHECK (coalesce(current_setting('qos.agent_platform_admin', true), '') = 'true');--> statement-breakpoint
CREATE POLICY agent_provider_connections_platform_update ON qos.agent_provider_connections
  FOR UPDATE
  TO qos_app
  USING (
    coalesce(current_setting('qos.agent_platform_admin', true), '') = 'true'
    OR coalesce(current_setting('qos.agent_credential_access', true), '') = 'true'
  )
  WITH CHECK (
    coalesce(current_setting('qos.agent_platform_admin', true), '') = 'true'
    OR coalesce(current_setting('qos.agent_credential_access', true), '') = 'true'
  );--> statement-breakpoint

-- Credentials: invisible unless the transaction explicitly opts in.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE qos.agent_provider_credentials TO qos_app;--> statement-breakpoint
ALTER TABLE qos.agent_provider_credentials ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.agent_provider_credentials FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY agent_provider_credentials_scoped_access ON qos.agent_provider_credentials
  FOR ALL
  TO qos_app
  USING (
    coalesce(current_setting('qos.agent_platform_admin', true), '') = 'true'
    OR coalesce(current_setting('qos.agent_credential_access', true), '') = 'true'
  )
  WITH CHECK (
    coalesce(current_setting('qos.agent_platform_admin', true), '') = 'true'
    OR coalesce(current_setting('qos.agent_credential_access', true), '') = 'true'
  );--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON TABLE qos.tenant_agent_bindings TO qos_app;--> statement-breakpoint
ALTER TABLE qos.tenant_agent_bindings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.tenant_agent_bindings FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_agent_bindings_tenant_isolation ON qos.tenant_agent_bindings
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint

-- The platform controls which provider agent serves a capability. Outside the
-- agent platform admin setting, a binding can only be enabled or disabled.
CREATE OR REPLACE FUNCTION qos.guard_tenant_agent_binding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = qos
AS $$
BEGIN
  IF coalesce(current_setting('qos.agent_platform_admin', true), '') = 'true' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Tenant agent bindings can only be created by the platform.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.public_id IS DISTINCT FROM OLD.public_id
    OR NEW.capability IS DISTINCT FROM OLD.capability
    OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.provider_agent_id IS DISTINCT FROM OLD.provider_agent_id
    OR NEW.approved_by_subject IS DISTINCT FROM OLD.approved_by_subject
    OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
    RAISE EXCEPTION 'Only the platform can change the approved agent for a tenant capability.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER tenant_agent_bindings_guard
  BEFORE INSERT OR UPDATE ON qos.tenant_agent_bindings
  FOR EACH ROW EXECUTE FUNCTION qos.guard_tenant_agent_binding();--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON TABLE qos.agent_runs TO qos_app;--> statement-breakpoint
ALTER TABLE qos.agent_runs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.agent_runs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY agent_runs_tenant_isolation ON qos.agent_runs
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint

-- Run lifecycle: queued -> running | failed; running -> running |
-- awaiting_approval | completed | failed. awaiting_approval, completed and
-- failed are final for QOS: an approval is never resolved by QOS.
CREATE OR REPLACE FUNCTION qos.guard_agent_run_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = qos
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.public_id IS DISTINCT FROM OLD.public_id
    OR NEW.binding_id IS DISTINCT FROM OLD.binding_id
    OR NEW.provider_agent_id IS DISTINCT FROM OLD.provider_agent_id
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.subject_type IS DISTINCT FROM OLD.subject_type
    OR NEW.subject_public_id IS DISTINCT FROM OLD.subject_public_id
    OR NEW.requested_by_subject IS DISTINCT FROM OLD.requested_by_subject THEN
    RAISE EXCEPTION 'Agent run identity fields are immutable.'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.status IN ('awaiting_approval', 'completed', 'failed')
    AND (NEW.status IS DISTINCT FROM OLD.status
      OR NEW.result IS DISTINCT FROM OLD.result
      OR NEW.provider_thread_id IS DISTINCT FROM OLD.provider_thread_id) THEN
    RAISE EXCEPTION 'Agent run % is already %.', OLD.public_id, OLD.status
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'queued' AND NEW.status NOT IN ('queued', 'running', 'failed') THEN
    RAISE EXCEPTION 'Agent run cannot move from queued to %.', NEW.status
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'running' AND NEW.status = 'queued' THEN
    RAISE EXCEPTION 'Agent run cannot move from running back to queued.'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER agent_runs_transition_guard
  BEFORE UPDATE ON qos.agent_runs
  FOR EACH ROW EXECUTE FUNCTION qos.guard_agent_run_transition();
