-- PR 4 (ADR-AI-02 decisions 13-15, 17): durable AI job queue and a dedicated
-- AI worker identity. Additive. Nothing uses the queue until the Menu Manager
-- execution mode is switched to queued_worker; no login is created here.

-- Roles. All NOLOGIN: a real worker or scaler login is provisioned separately
-- and granted one of these. None has BYPASSRLS.
DO $$ BEGIN
  CREATE ROLE qos_ai_worker NOLOGIN;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE ROLE qos_ai_scaler NOLOGIN;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
-- Owns the queue's SECURITY DEFINER functions; can do nothing else.
DO $$ BEGIN
  CREATE ROLE qos_ai_queue_owner NOLOGIN NOINHERIT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
-- The migrating user must be able to SET ROLE to the owner to hand functions
-- over (PostgreSQL 16+ no longer implies this for non-superuser creators).
-- INHERIT FALSE: the migrator never gains the owner's row visibility.
DO $$ BEGIN
  IF current_setting('server_version_num')::int >= 160000 THEN
    EXECUTE format('GRANT qos_ai_queue_owner TO %I WITH INHERIT FALSE, SET TRUE', current_user);
  ELSE
    EXECUTE format('GRANT qos_ai_queue_owner TO %I', current_user);
  END IF;
END $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA qos TO qos_ai_worker, qos_ai_scaler, qos_ai_queue_owner;--> statement-breakpoint

-- Every accepted run records how it executes. NULL is a run accepted before
-- this column existed, which always ran inline.
ALTER TABLE "qos"."agent_runs" ADD COLUMN IF NOT EXISTS "execution_mode" text;--> statement-breakpoint
ALTER TABLE "qos"."agent_runs" ADD CONSTRAINT "agent_runs_execution_mode" CHECK ("execution_mode" IS NULL OR "execution_mode" IN ('inline', 'queued_worker'));--> statement-breakpoint

-- Same rules as 0040, plus execution_mode is immutable: flags never move
-- accepted work between inline and worker execution.
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
    OR NEW.run_config IS DISTINCT FROM OLD.run_config
    OR NEW.execution_mode IS DISTINCT FROM OLD.execution_mode THEN
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

-- One job per run and kind. "leased" carries a fencing token; every
-- authoritative write by a worker must present it while the lease is live.
-- operator_review is terminal: QOS cannot tell whether paid work happened.
CREATE TABLE IF NOT EXISTS "qos"."ai_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"job_kind" text NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"last_claimed_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ai_jobs_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "ai_jobs_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "ai_jobs_run_kind_unique" UNIQUE("tenant_id","job_kind","agent_run_id"),
	CONSTRAINT "ai_jobs_status" CHECK ("status" IN ('queued', 'leased', 'completed', 'failed', 'cancelled', 'operator_review')),
	CONSTRAINT "ai_jobs_lease_shape" CHECK (
		("status" = 'leased') = ("lease_token" IS NOT NULL AND "lease_owner" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
	),
	CONSTRAINT "ai_jobs_finished_shape" CHECK (
		("status" IN ('completed', 'failed', 'cancelled', 'operator_review')) = ("finished_at" IS NOT NULL)
	),
	CONSTRAINT "ai_jobs_attempt_count_nonnegative" CHECK ("attempt_count" >= 0)
);--> statement-breakpoint
ALTER TABLE "qos"."ai_jobs" ADD CONSTRAINT "ai_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "qos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."ai_jobs" ADD CONSTRAINT "ai_jobs_run_fk" FOREIGN KEY ("tenant_id","agent_run_id") REFERENCES "qos"."agent_runs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_jobs_due_idx" ON "qos"."ai_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_jobs_tenant_status_idx" ON "qos"."ai_jobs" USING btree ("tenant_id","status");--> statement-breakpoint

-- Attempt evidence (decision 7/13): when dispatch began, what the provider
-- outcome proved, any reference. Inserted only by the claim function.
CREATE TABLE IF NOT EXISTS "qos"."ai_job_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"lease_token" uuid NOT NULL,
	"worker_id" text NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"outcome" text,
	"provider_outcome" text,
	"error_code" text,
	CONSTRAINT "ai_job_attempts_lease_token_unique" UNIQUE("lease_token"),
	CONSTRAINT "ai_job_attempts_number_unique" UNIQUE("job_id","attempt_number"),
	CONSTRAINT "ai_job_attempts_number_positive" CHECK ("attempt_number" > 0),
	CONSTRAINT "ai_job_attempts_outcome" CHECK ("outcome" IS NULL OR "outcome" IN ('completed', 'rescheduled', 'failed', 'operator_review', 'lease_expired')),
	CONSTRAINT "ai_job_attempts_provider_outcome" CHECK ("provider_outcome" IS NULL OR "provider_outcome" IN ('not_dispatched', 'rejected', 'submission_unknown', 'failed_after_processing', 'read_failed')),
	CONSTRAINT "ai_job_attempts_finished_shape" CHECK (("outcome" IS NULL) = ("finished_at" IS NULL))
);--> statement-breakpoint
ALTER TABLE "qos"."ai_job_attempts" ADD CONSTRAINT "ai_job_attempts_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "qos"."ai_jobs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

CREATE OR REPLACE FUNCTION qos.guard_ai_job()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = qos
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.public_id IS DISTINCT FROM OLD.public_id
    OR NEW.job_kind IS DISTINCT FROM OLD.job_kind
    OR NEW.agent_run_id IS DISTINCT FROM OLD.agent_run_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.attempt_count < OLD.attempt_count THEN
    RAISE EXCEPTION 'AI job identity fields are immutable.'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.status IN ('completed', 'failed', 'cancelled', 'operator_review') THEN
    RAISE EXCEPTION 'AI job % is already %.', OLD.public_id, OLD.status
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'queued' AND NEW.status IN ('leased', 'cancelled'))
    OR (OLD.status = 'leased' AND NEW.status IN ('queued', 'completed', 'failed', 'operator_review'))
  ) THEN
    RAISE EXCEPTION 'AI job cannot move from % to %.', OLD.status, NEW.status
      USING ERRCODE = '55000';
  END IF;

  -- A new lease always means a new token and a new attempt.
  IF NEW.status = 'leased' AND OLD.status = 'queued'
    AND (NEW.attempt_count <> OLD.attempt_count + 1 OR NEW.lease_token IS NOT DISTINCT FROM OLD.lease_token) THEN
    RAISE EXCEPTION 'An AI job lease needs a fresh token and attempt.'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'leased' AND NEW.status = 'leased' AND NEW.lease_token IS DISTINCT FROM OLD.lease_token THEN
    RAISE EXCEPTION 'An AI job lease token cannot be replaced while leased.'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER ai_jobs_guard
  BEFORE UPDATE ON qos.ai_jobs
  FOR EACH ROW EXECUTE FUNCTION qos.guard_ai_job();--> statement-breakpoint

CREATE OR REPLACE FUNCTION qos.guard_ai_job_attempt()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = qos
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.job_id IS DISTINCT FROM OLD.job_id
    OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
    OR NEW.lease_token IS DISTINCT FROM OLD.lease_token
    OR NEW.worker_id IS DISTINCT FROM OLD.worker_id
    OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
    OR (OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at) THEN
    RAISE EXCEPTION 'AI job attempt evidence is immutable.'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.finished_at IS NOT NULL THEN
    RAISE EXCEPTION 'AI job attempt % is already finished.', OLD.attempt_number
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER ai_job_attempts_guard
  BEFORE UPDATE ON qos.ai_job_attempts
  FOR EACH ROW EXECUTE FUNCTION qos.guard_ai_job_attempt();--> statement-breakpoint

-- Privileges (ADR C.6). Default privileges (0000) would give qos_app full DML.
REVOKE ALL ON TABLE qos.ai_jobs, qos.ai_job_attempts FROM qos_app;--> statement-breakpoint
-- API: enqueue on admission and read status; it cannot lease, finish or
-- rewrite jobs (cancelling a never-claimed job goes through a function).
GRANT SELECT, INSERT ON TABLE qos.ai_jobs TO qos_app;--> statement-breakpoint
GRANT SELECT ON TABLE qos.ai_job_attempts TO qos_app;--> statement-breakpoint
-- Worker: tenant-scoped reads and fenced writes, always under tenant context.
GRANT SELECT, UPDATE ON TABLE qos.ai_jobs, qos.ai_job_attempts TO qos_ai_worker;--> statement-breakpoint
-- Function owner: exactly the queue tables.
GRANT SELECT, UPDATE ON TABLE qos.ai_jobs TO qos_ai_queue_owner;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE qos.ai_job_attempts TO qos_ai_queue_owner;--> statement-breakpoint

-- What the Menu Manager job needs, and nothing broader. These tables are
-- tenant-isolated by FORCE RLS policies that apply to every role.
GRANT SELECT ON TABLE
  qos.tenants,
  qos.locations,
  qos.staff_identities,
  qos.staff_memberships,
  qos.staff_location_scopes,
  qos.catalogue_menus,
  qos.catalogue_menu_locations,
  qos.tenant_agent_bindings,
  qos.agent_run_inputs
TO qos_ai_worker;--> statement-breakpoint
GRANT SELECT, UPDATE ON TABLE qos.agent_runs TO qos_ai_worker;--> statement-breakpoint
-- SELECT is needed for INSERT ... RETURNING. The 0025 policies name qos_app
-- only, so the worker gets the same tenant-scoped pair.
GRANT SELECT, INSERT ON TABLE qos.tenant_audit_events TO qos_ai_worker;--> statement-breakpoint
CREATE POLICY tenant_audit_events_worker_select ON qos.tenant_audit_events
  FOR SELECT
  TO qos_ai_worker
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY tenant_audit_events_worker_insert ON qos.tenant_audit_events
  FOR INSERT
  TO qos_ai_worker
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
-- Provider connection status and the adapter credential, under the same
-- explicit credential opt-in as the API. Never the platform-admin path.
GRANT SELECT, UPDATE ON TABLE qos.agent_provider_connections, qos.agent_provider_credentials TO qos_ai_worker;--> statement-breakpoint
CREATE POLICY agent_provider_connections_worker_read ON qos.agent_provider_connections
  FOR SELECT
  TO qos_ai_worker
  USING (true);--> statement-breakpoint
CREATE POLICY agent_provider_connections_worker_update ON qos.agent_provider_connections
  FOR UPDATE
  TO qos_ai_worker
  USING (coalesce(current_setting('qos.agent_credential_access', true), '') = 'true')
  WITH CHECK (coalesce(current_setting('qos.agent_credential_access', true), '') = 'true');--> statement-breakpoint
CREATE POLICY agent_provider_credentials_worker_access ON qos.agent_provider_credentials
  FOR ALL
  TO qos_ai_worker
  USING (coalesce(current_setting('qos.agent_credential_access', true), '') = 'true')
  WITH CHECK (coalesce(current_setting('qos.agent_credential_access', true), '') = 'true');--> statement-breakpoint

ALTER TABLE qos.ai_jobs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.ai_jobs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY ai_jobs_tenant_isolation ON qos.ai_jobs
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
-- The owner sees every row, but only inside its functions: it cannot log in
-- and nobody inherits it.
CREATE POLICY ai_jobs_queue_owner ON qos.ai_jobs
  FOR ALL
  TO qos_ai_queue_owner
  USING (true)
  WITH CHECK (true);--> statement-breakpoint
ALTER TABLE qos.ai_job_attempts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.ai_job_attempts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY ai_job_attempts_tenant_isolation ON qos.ai_job_attempts
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY ai_job_attempts_queue_owner ON qos.ai_job_attempts
  FOR ALL
  TO qos_ai_queue_owner
  USING (true)
  WITH CHECK (true);--> statement-breakpoint

-- Claim. Serialized so global, tenant and kind caps hold across replicas.
-- Expired leases are closed out first: the stale attempt is marked
-- lease_expired and the job re-queued. Whether that attempt had begun
-- dispatch is returned, so the handler (not this function) decides between
-- continuing and operator review; nothing is resubmitted blindly.
-- Fairness: the tenant served longest ago goes first, then the earliest due job.
CREATE OR REPLACE FUNCTION qos.claim_next_ai_job(
  p_worker_id text,
  p_job_kinds text[],
  p_lease_seconds integer,
  p_max_active_global integer,
  p_max_active_per_tenant integer,
  p_max_active_per_kind integer
)
RETURNS TABLE (
  job_id uuid,
  tenant_id uuid,
  job_public_id text,
  job_kind text,
  agent_run_id uuid,
  lease_token uuid,
  lease_expires_at timestamp with time zone,
  attempt_number integer,
  uncertain_prior_dispatch boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_job qos.ai_jobs%ROWTYPE;
  v_token uuid := gen_random_uuid();
BEGIN
  IF p_worker_id IS NULL OR length(p_worker_id) NOT BETWEEN 1 AND 200
    OR p_lease_seconds NOT BETWEEN 5 AND 3600
    OR p_max_active_global < 1 OR p_max_active_per_tenant < 1 OR p_max_active_per_kind < 1
    OR p_job_kinds IS NULL OR cardinality(p_job_kinds) = 0 THEN
    RAISE EXCEPTION 'Invalid AI job claim arguments.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('qos.claim_next_ai_job'));

  UPDATE qos.ai_job_attempts a
  SET finished_at = pg_catalog.now(), outcome = 'lease_expired'
  FROM qos.ai_jobs j
  WHERE j.status = 'leased'
    AND j.lease_expires_at < pg_catalog.now()
    AND a.job_id = j.id
    AND a.lease_token = j.lease_token
    AND a.finished_at IS NULL;

  UPDATE qos.ai_jobs j
  SET status = 'queued',
      lease_token = NULL,
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = 'lease_expired',
      last_error_message = 'The worker lease expired before the job step finished.',
      next_attempt_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE j.status = 'leased'
    AND j.lease_expires_at < pg_catalog.now();

  IF (SELECT count(*) FROM qos.ai_jobs WHERE status = 'leased') >= p_max_active_global THEN
    RETURN;
  END IF;

  SELECT j.* INTO v_job
  FROM qos.ai_jobs j
  WHERE j.status = 'queued'
    AND j.next_attempt_at <= pg_catalog.now()
    AND j.job_kind = ANY (p_job_kinds)
    AND (SELECT count(*) FROM qos.ai_jobs t WHERE t.tenant_id = j.tenant_id AND t.status = 'leased') < p_max_active_per_tenant
    AND (SELECT count(*) FROM qos.ai_jobs k WHERE k.job_kind = j.job_kind AND k.status = 'leased') < p_max_active_per_kind
  ORDER BY
    (SELECT max(s.last_claimed_at) FROM qos.ai_jobs s WHERE s.tenant_id = j.tenant_id) ASC NULLS FIRST,
    j.next_attempt_at ASC,
    j.created_at ASC
  LIMIT 1
  FOR UPDATE OF j SKIP LOCKED;

  IF v_job.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE qos.ai_jobs j
  SET status = 'leased',
      lease_token = v_token,
      lease_owner = p_worker_id,
      lease_expires_at = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds),
      attempt_count = j.attempt_count + 1,
      last_claimed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE j.id = v_job.id;

  INSERT INTO qos.ai_job_attempts (tenant_id, job_id, attempt_number, lease_token, worker_id)
  VALUES (v_job.tenant_id, v_job.id, v_job.attempt_count + 1, v_token, p_worker_id);

  RETURN QUERY
  SELECT j.id, j.tenant_id, j.public_id, j.job_kind, j.agent_run_id, j.lease_token, j.lease_expires_at, j.attempt_count,
    EXISTS (
      SELECT 1 FROM qos.ai_job_attempts a
      WHERE a.job_id = j.id
        AND a.outcome = 'lease_expired'
        AND a.dispatched_at IS NOT NULL
    )
  FROM qos.ai_jobs j
  WHERE j.id = v_job.id;
END;
$$;--> statement-breakpoint

-- Extends a live lease. An expired lease is never revived: the holder has
-- lost the job even if nobody has reclaimed it yet.
CREATE OR REPLACE FUNCTION qos.heartbeat_ai_job(p_job_id uuid, p_lease_token uuid, p_lease_seconds integer)
RETURNS timestamp with time zone
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_expires timestamp with time zone;
BEGIN
  IF p_lease_seconds NOT BETWEEN 5 AND 3600 THEN
    RAISE EXCEPTION 'Invalid AI job lease length.' USING ERRCODE = '22023';
  END IF;
  UPDATE qos.ai_jobs j
  SET lease_expires_at = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds),
      updated_at = pg_catalog.now()
  WHERE j.id = p_job_id
    AND j.status = 'leased'
    AND j.lease_token = p_lease_token
    AND j.lease_expires_at > pg_catalog.now()
  RETURNING j.lease_expires_at INTO v_expires;
  RETURN v_expires;
END;
$$;--> statement-breakpoint

-- Scale signal: one aggregate number, no tenant data. Counts due queued work,
-- every leased job (including expired leases that need recovery) so the
-- worker wakes for them after scale-to-zero. Due polls are queued jobs.
CREATE OR REPLACE FUNCTION qos.count_due_ai_work()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT count(*)
  FROM qos.ai_jobs j
  WHERE j.status = 'leased'
     OR (j.status = 'queued' AND j.next_attempt_at <= pg_catalog.now());
$$;--> statement-breakpoint

-- Lets the API cancel a job no worker has claimed, for its own tenant only.
CREATE OR REPLACE FUNCTION qos.cancel_queued_ai_job(p_job_public_id text, p_error_code text, p_error_message text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tenant uuid := nullif(pg_catalog.current_setting('qos.current_tenant_id', true), '')::uuid;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Tenant context is required.' USING ERRCODE = '42501';
  END IF;
  UPDATE qos.ai_jobs j
  SET status = 'cancelled',
      last_error_code = left(p_error_code, 100),
      last_error_message = left(p_error_message, 2000),
      finished_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE j.tenant_id = v_tenant
    AND j.public_id = p_job_public_id
    AND j.status = 'queued'
    AND j.attempt_count = 0;
  RETURN FOUND;
END;
$$;--> statement-breakpoint

-- For a non-superuser migrator, ALTER ... OWNER requires the new owner to hold
-- CREATE on the schema. It is held only for the hand-off.
GRANT CREATE ON SCHEMA qos TO qos_ai_queue_owner;--> statement-breakpoint
ALTER FUNCTION qos.claim_next_ai_job(text, text[], integer, integer, integer, integer) OWNER TO qos_ai_queue_owner;--> statement-breakpoint
ALTER FUNCTION qos.heartbeat_ai_job(uuid, uuid, integer) OWNER TO qos_ai_queue_owner;--> statement-breakpoint
ALTER FUNCTION qos.count_due_ai_work() OWNER TO qos_ai_queue_owner;--> statement-breakpoint
ALTER FUNCTION qos.cancel_queued_ai_job(text, text, text) OWNER TO qos_ai_queue_owner;--> statement-breakpoint
REVOKE CREATE ON SCHEMA qos FROM qos_ai_queue_owner;--> statement-breakpoint
REVOKE ALL ON FUNCTION qos.claim_next_ai_job(text, text[], integer, integer, integer, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION qos.heartbeat_ai_job(uuid, uuid, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION qos.count_due_ai_work() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION qos.cancel_queued_ai_job(text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION qos.claim_next_ai_job(text, text[], integer, integer, integer, integer) TO qos_ai_worker;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION qos.heartbeat_ai_job(uuid, uuid, integer) TO qos_ai_worker;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION qos.count_due_ai_work() TO qos_ai_scaler;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION qos.cancel_queued_ai_job(text, text, text) TO qos_app;
