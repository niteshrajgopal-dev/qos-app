-- PR 3b (ADR-AI-02 decision 16): minimum spend admission for new paid AI
-- paths. Additive only. No path is wired to it yet; a path stays disabled
-- until its policy is fully configured. Existing AI photo limits are untouched.

-- One reservation per subject and path. Request units are the quota measure;
-- an estimated cost is recorded only when versioned pricing exists, and
-- reported usage is stored separately. "uncertain" is potentially billed
-- work with an unknown outcome and keeps counting until explicitly resolved.
CREATE TABLE IF NOT EXISTS "qos"."ai_spend_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"path" text NOT NULL,
	"provider" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_public_id" text NOT NULL,
	"units" integer NOT NULL,
	"estimated_cost_micros" bigint,
	"pricing_version" text,
	"state" text DEFAULT 'reserved' NOT NULL,
	"daily_window" date NOT NULL,
	"monthly_window" date NOT NULL,
	"dispatched_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"outcome" text,
	"reported_usage" jsonb,
	"resolution" text,
	"resolved_by_subject" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "ai_spend_reservations_public_id_unique" UNIQUE("tenant_id","public_id"),
	CONSTRAINT "ai_spend_reservations_subject_unique" UNIQUE("tenant_id","path","subject_type","subject_public_id"),
	CONSTRAINT "ai_spend_reservations_units_positive" CHECK ("units" > 0),
	CONSTRAINT "ai_spend_reservations_cost_nonnegative" CHECK ("estimated_cost_micros" IS NULL OR "estimated_cost_micros" >= 0),
	CONSTRAINT "ai_spend_reservations_cost_priced" CHECK (("estimated_cost_micros" IS NULL) = ("pricing_version" IS NULL)),
	CONSTRAINT "ai_spend_reservations_state" CHECK ("state" IN ('reserved', 'consumed', 'released', 'uncertain')),
	CONSTRAINT "ai_spend_reservations_outcome_dispatched" CHECK ("state" NOT IN ('consumed', 'uncertain') OR "dispatched_at" IS NOT NULL),
	-- State, outcome and resolution must agree. Only an undispatched
	-- reservation can end as released_unstarted or expired_unstarted; only a
	-- proven not_dispatched/rejected outcome or an explicit not_billed
	-- resolution can release work after dispatch began.
	CONSTRAINT "ai_spend_reservations_state_outcome" CHECK (
		("state" = 'reserved' AND "outcome" IS NULL AND "resolution" IS NULL)
		OR ("state" = 'uncertain' AND "outcome" = 'submission_unknown' AND "resolution" IS NULL)
		OR ("state" = 'consumed' AND "outcome" IN ('completed', 'failed_after_processing') AND "resolution" IS NULL)
		OR ("state" = 'consumed' AND "outcome" = 'submission_unknown' AND "resolution" = 'billed')
		OR ("state" = 'released' AND "outcome" IN ('released_unstarted', 'expired_unstarted') AND "resolution" IS NULL AND "dispatched_at" IS NULL)
		OR ("state" = 'released' AND "outcome" IN ('not_dispatched', 'rejected') AND "resolution" IS NULL)
		OR ("state" = 'released' AND "outcome" = 'submission_unknown' AND "resolution" = 'not_billed')
	),
	CONSTRAINT "ai_spend_reservations_resolution_actor" CHECK (("resolution" IS NULL) = ("resolved_by_subject" IS NULL)),
	CONSTRAINT "ai_spend_reservations_monthly_window" CHECK ("monthly_window" = date_trunc('month', "monthly_window")::date)
);--> statement-breakpoint
ALTER TABLE "qos"."ai_spend_reservations" ADD CONSTRAINT "ai_spend_reservations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "qos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_spend_reservations_expiry_idx" ON "qos"."ai_spend_reservations" USING btree ("tenant_id","expires_at") WHERE "state" = 'reserved' AND "dispatched_at" IS NULL;--> statement-breakpoint

-- Per-tenant usage per window. Concurrency uses the fixed window 1970-01-01.
CREATE TABLE IF NOT EXISTS "qos"."ai_spend_tenant_counters" (
	"tenant_id" uuid NOT NULL,
	"scope_key" text NOT NULL,
	"window_start" date NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_spend_tenant_counters_pk" PRIMARY KEY("tenant_id","scope_key","window_start"),
	CONSTRAINT "ai_spend_tenant_counters_units_nonnegative" CHECK ("units" >= 0)
);--> statement-breakpoint
ALTER TABLE "qos"."ai_spend_tenant_counters" ADD CONSTRAINT "ai_spend_tenant_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "qos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- Platform and provider totals. Aggregate numbers only, no tenant data, so
-- every tenant's admission can update them atomically with a conditional
-- increment; that is what makes the platform allowance race-safe.
CREATE TABLE IF NOT EXISTS "qos"."ai_spend_platform_counters" (
	"scope_key" text NOT NULL,
	"window_start" date NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_spend_platform_counters_pk" PRIMARY KEY("scope_key","window_start"),
	CONSTRAINT "ai_spend_platform_counters_units_nonnegative" CHECK ("units" >= 0)
);--> statement-breakpoint

-- Default privileges (0000) grant DELETE on new tables; spend history and
-- counters must not be deletable by the runtime.
REVOKE ALL ON TABLE qos.ai_spend_reservations, qos.ai_spend_tenant_counters, qos.ai_spend_platform_counters FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE qos.ai_spend_reservations, qos.ai_spend_tenant_counters, qos.ai_spend_platform_counters TO qos_app;--> statement-breakpoint

ALTER TABLE qos.ai_spend_reservations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.ai_spend_reservations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY ai_spend_reservations_tenant_isolation ON qos.ai_spend_reservations
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE qos.ai_spend_tenant_counters ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.ai_spend_tenant_counters FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY ai_spend_tenant_counters_tenant_isolation ON qos.ai_spend_tenant_counters
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE qos.ai_spend_platform_counters ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.ai_spend_platform_counters FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY ai_spend_platform_counters_aggregate ON qos.ai_spend_platform_counters
  FOR ALL
  USING (true)
  WITH CHECK (true);--> statement-breakpoint

-- Reservation lifecycle: reserved -> consumed | released | uncertain;
-- uncertain -> consumed | released only with an explicit resolution. Which
-- outcomes each state allows is the state_outcome check; this guard covers
-- transitions and immutability.
CREATE OR REPLACE FUNCTION qos.guard_ai_spend_reservation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = qos
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.public_id IS DISTINCT FROM OLD.public_id
    OR NEW.path IS DISTINCT FROM OLD.path
    OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.subject_type IS DISTINCT FROM OLD.subject_type
    OR NEW.subject_public_id IS DISTINCT FROM OLD.subject_public_id
    OR NEW.units IS DISTINCT FROM OLD.units
    OR NEW.estimated_cost_micros IS DISTINCT FROM OLD.estimated_cost_micros
    OR NEW.pricing_version IS DISTINCT FROM OLD.pricing_version
    OR NEW.daily_window IS DISTINCT FROM OLD.daily_window
    OR NEW.monthly_window IS DISTINCT FROM OLD.monthly_window
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'AI spend reservation accounting fields are immutable.'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at THEN
    RAISE EXCEPTION 'AI spend reservation dispatch time is immutable.'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.state IN ('consumed', 'released') AND (
    NEW.state IS DISTINCT FROM OLD.state
    OR NEW.outcome IS DISTINCT FROM OLD.outcome
    OR NEW.reported_usage IS DISTINCT FROM OLD.reported_usage
    OR NEW.resolution IS DISTINCT FROM OLD.resolution
    OR NEW.resolved_by_subject IS DISTINCT FROM OLD.resolved_by_subject
    OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at) THEN
    RAISE EXCEPTION 'AI spend reservation % is already %.', OLD.public_id, OLD.state
      USING ERRCODE = '55000';
  END IF;

  IF NEW.state = 'reserved' AND OLD.state <> 'reserved' THEN
    RAISE EXCEPTION 'An AI spend reservation cannot return to reserved.'
      USING ERRCODE = '55000';
  END IF;

  -- With the outcome pinned, state_outcome only lets uncertain work leave
  -- through resolution billed / not_billed.
  IF OLD.state = 'uncertain' AND NEW.outcome IS DISTINCT FROM OLD.outcome THEN
    RAISE EXCEPTION 'An uncertain AI spend reservation needs an explicit resolution.'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.resolution IS NOT NULL AND OLD.state <> 'uncertain' THEN
    RAISE EXCEPTION 'Only an uncertain AI spend reservation can be resolved.'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER ai_spend_reservations_guard
  BEFORE UPDATE ON qos.ai_spend_reservations
  FOR EACH ROW EXECUTE FUNCTION qos.guard_ai_spend_reservation();
