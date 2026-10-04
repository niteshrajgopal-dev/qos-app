-- AI photo generation on the AI worker. A job now belongs to exactly one
-- subject: an agent run (Menu Manager) or the media asset it generates.
ALTER TABLE "qos"."ai_jobs" ALTER COLUMN "agent_run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "qos"."ai_jobs" ADD COLUMN IF NOT EXISTS "media_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "qos"."ai_jobs" ADD CONSTRAINT "ai_jobs_one_subject" CHECK (num_nonnulls("agent_run_id", "media_asset_id") = 1);--> statement-breakpoint
ALTER TABLE "qos"."ai_jobs" ADD CONSTRAINT "ai_jobs_kind_subject" CHECK (
	("job_kind" <> 'menu_manager.run' OR "agent_run_id" IS NOT NULL)
	AND ("job_kind" <> 'ai_photo.generate' OR "media_asset_id" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "qos"."ai_jobs" ADD CONSTRAINT "ai_jobs_asset_kind_unique" UNIQUE ("tenant_id", "job_kind", "media_asset_id");--> statement-breakpoint
ALTER TABLE "qos"."ai_jobs" ADD CONSTRAINT "ai_jobs_media_asset_fk" FOREIGN KEY ("tenant_id", "media_asset_id") REFERENCES "qos"."catalogue_media_assets"("tenant_id", "id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

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
    OR NEW.media_asset_id IS DISTINCT FROM OLD.media_asset_id
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

-- The photo worker reads the request it was handed, re-checks the product,
-- stores the image through the upload grant and settles the spend
-- reservation. Every one of these tables is tenant-isolated for all roles.
GRANT SELECT, UPDATE ON TABLE qos.catalogue_media_assets, qos.catalogue_media_upload_grants TO qos_ai_worker;--> statement-breakpoint
GRANT SELECT ON TABLE qos.catalogue_products TO qos_ai_worker;--> statement-breakpoint
GRANT SELECT, UPDATE ON TABLE qos.ai_spend_reservations, qos.ai_spend_tenant_counters, qos.ai_spend_platform_counters TO qos_ai_worker;
