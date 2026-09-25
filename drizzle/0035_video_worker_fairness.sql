ALTER TABLE "qos"."video_processing_jobs" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "qos"."video_processing_jobs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "qos"."video_processing_jobs" ADD COLUMN "claimed_by" text;--> statement-breakpoint
CREATE INDEX "video_processing_jobs_status_next_attempt_idx" ON "qos"."video_processing_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "video_processing_jobs_tenant_started_idx" ON "qos"."video_processing_jobs" USING btree ("tenant_id","started_at");--> statement-breakpoint
-- Cross-tenant claim for the video worker. SECURITY DEFINER so the worker can
-- run as qos_app (no admin credentials) despite FORCE RLS; it returns only the
-- claimed job's identity and every later read/write happens under tenant context.
CREATE OR REPLACE FUNCTION qos.claim_next_video_processing_job(
  p_worker_id text,
  p_lease_seconds integer,
  p_max_active_per_tenant integer,
  p_max_retries integer
)
RETURNS TABLE (
  job_id uuid,
  tenant_id uuid,
  product_id uuid,
  asset_id uuid,
  correlation_id text,
  source_storage_path text,
  retry_count integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = qos
AS $$
#variable_conflict use_column
DECLARE
  v_job_id uuid;
BEGIN
  -- Serialize claims so the per-tenant cap cannot be overshot by concurrent workers.
  PERFORM pg_advisory_xact_lock(hashtext('qos.claim_next_video_processing_job'));

  -- Recover jobs whose worker died or was killed mid-run. An expired lease
  -- counts as a failed attempt so a job that always crashes its worker is
  -- eventually quarantined instead of looping forever.
  WITH expired AS (
    UPDATE qos.video_processing_jobs j
    SET status = CASE
          WHEN j.retry_count + 1 >= p_max_retries
            THEN 'quarantined'::qos.video_processing_job_status
          ELSE 'queued'::qos.video_processing_job_status
        END,
        retry_count = j.retry_count + 1,
        last_error_message = 'Worker lease expired before the job finished (worker '
          || coalesce(j.claimed_by, 'unknown') || ').',
        last_error_at = now(),
        next_attempt_at = now(),
        lease_expires_at = NULL,
        claimed_by = NULL,
        updated_at = now()
    WHERE j.status = 'processing'
      AND j.lease_expires_at IS NOT NULL
      AND j.lease_expires_at < now()
    RETURNING j.tenant_id, j.asset_id, j.status, j.retry_count, j.last_error_message
  )
  UPDATE qos.catalogue_media_assets a
  SET status = 'rejected',
      failure_reason = 'Quarantined after ' || e.retry_count || ' attempts: ' || e.last_error_message,
      updated_at = now()
  FROM expired e
  WHERE e.status = 'quarantined'
    AND a.tenant_id = e.tenant_id
    AND a.id = e.asset_id;

  -- Fairness: among tenants below their active cap, serve the one whose last
  -- job started longest ago (never-served tenants first), then that tenant's
  -- earliest due job.
  SELECT j.id INTO v_job_id
  FROM qos.video_processing_jobs j
  WHERE j.status = 'queued'
    AND j.next_attempt_at <= now()
    AND (
      SELECT count(*)
      FROM qos.video_processing_jobs active
      WHERE active.tenant_id = j.tenant_id
        AND active.status = 'processing'
    ) < p_max_active_per_tenant
  ORDER BY
    (
      SELECT max(served.started_at)
      FROM qos.video_processing_jobs served
      WHERE served.tenant_id = j.tenant_id
    ) ASC NULLS FIRST,
    j.next_attempt_at ASC,
    j.created_at ASC
  LIMIT 1
  FOR UPDATE OF j SKIP LOCKED;

  IF v_job_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE qos.video_processing_jobs j
  SET status = 'processing',
      started_at = now(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      claimed_by = p_worker_id,
      updated_at = now()
  WHERE j.id = v_job_id
  RETURNING j.id, j.tenant_id, j.product_id, j.asset_id, j.correlation_id, j.source_storage_path, j.retry_count;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION qos.claim_next_video_processing_job(text, integer, integer, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION qos.claim_next_video_processing_job(text, integer, integer, integer) TO qos_app;--> statement-breakpoint
-- Scale signal for the worker's KEDA postgresql rule (scale-to-zero). RLS hides
-- every row from qos_app without tenant context, so the autoscaler needs this
-- definer function; it exposes a single count and no tenant data.
-- Includes in-flight jobs so the worker is not scaled in mid-transcode.
CREATE OR REPLACE FUNCTION qos.count_active_video_processing_jobs()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = qos
AS $$
  SELECT count(*)
  FROM qos.video_processing_jobs j
  WHERE j.status = 'processing'
     OR (j.status = 'queued' AND j.next_attempt_at <= now());
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION qos.count_active_video_processing_jobs() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION qos.count_active_video_processing_jobs() TO qos_app;
