-- PR 2b (ADR-AI-02 decision 9): a run pins its agent definition, execution
-- identity, operational configuration and bounded input when it is accepted.
-- Additive only. Rows created before this migration keep NULL pins and are
-- read through the documented legacy path.
ALTER TABLE "qos"."agent_runs" ADD COLUMN IF NOT EXISTS "definition_key" text;--> statement-breakpoint
ALTER TABLE "qos"."agent_runs" ADD COLUMN IF NOT EXISTS "definition_version" text;--> statement-breakpoint
ALTER TABLE "qos"."agent_runs" ADD COLUMN IF NOT EXISTS "execution_identity" jsonb;--> statement-breakpoint
ALTER TABLE "qos"."agent_runs" ADD COLUMN IF NOT EXISTS "run_config" jsonb;--> statement-breakpoint
ALTER TABLE "qos"."agent_runs" ADD CONSTRAINT "agent_runs_pin_complete" CHECK (
  ("definition_key" IS NULL AND "definition_version" IS NULL AND "execution_identity" IS NULL AND "run_config" IS NULL)
  OR ("definition_key" IS NOT NULL AND "definition_version" IS NOT NULL AND "execution_identity" IS NOT NULL AND "run_config" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "qos"."agent_runs" ADD CONSTRAINT "agent_runs_tenant_id_id_unique" UNIQUE ("tenant_id", "id");--> statement-breakpoint

-- The exact bounded input text sent to the executor. Stored as text, not
-- jsonb, so its SHA-256 can be re-verified byte for byte before dispatch.
-- Never copied into audit metadata or logs. Retention is an open owner
-- decision; the application role cannot update or delete rows.
CREATE TABLE IF NOT EXISTS "qos"."agent_run_inputs" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"input_schema" text NOT NULL,
	"payload" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_run_inputs_sha256_format" CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "agent_run_inputs_payload_size" CHECK (octet_length("payload") BETWEEN 1 AND 1048576)
);--> statement-breakpoint
ALTER TABLE "qos"."agent_run_inputs" ADD CONSTRAINT "agent_run_inputs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "qos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."agent_run_inputs" ADD CONSTRAINT "agent_run_inputs_run_fk" FOREIGN KEY ("tenant_id", "run_id") REFERENCES "qos"."agent_runs"("tenant_id", "id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- Default privileges (0000) grant UPDATE and DELETE on new tables.
REVOKE ALL ON TABLE qos.agent_run_inputs FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE qos.agent_run_inputs TO qos_app;--> statement-breakpoint
ALTER TABLE qos.agent_run_inputs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.agent_run_inputs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY agent_run_inputs_tenant_isolation ON qos.agent_run_inputs
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint

CREATE OR REPLACE FUNCTION qos.reject_agent_run_input_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = qos
AS $$
BEGIN
  RAISE EXCEPTION 'Pinned agent run input is immutable.'
    USING ERRCODE = '42501';
END;
$$;--> statement-breakpoint
CREATE TRIGGER agent_run_inputs_immutable
  BEFORE UPDATE ON qos.agent_run_inputs
  FOR EACH ROW EXECUTE FUNCTION qos.reject_agent_run_input_update();--> statement-breakpoint

-- Same lifecycle rules as 0038, plus: pins and the request summary are
-- immutable once written, and a legacy row cannot gain pins later.
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
    OR NEW.requested_by_subject IS DISTINCT FROM OLD.requested_by_subject
    OR NEW.request_summary IS DISTINCT FROM OLD.request_summary
    OR NEW.definition_key IS DISTINCT FROM OLD.definition_key
    OR NEW.definition_version IS DISTINCT FROM OLD.definition_version
    OR NEW.execution_identity IS DISTINCT FROM OLD.execution_identity
    OR NEW.run_config IS DISTINCT FROM OLD.run_config THEN
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
$$;
