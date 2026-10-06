-- PR 7: native Menu Manager executor. Hyperagent stays the default.
-- agents_sdk runs do not use a tenant Hyperagent binding.

ALTER TYPE "qos"."agent_provider" ADD VALUE IF NOT EXISTS 'agents_sdk';--> statement-breakpoint

ALTER TABLE "qos"."agent_runs" ALTER COLUMN "binding_id" DROP NOT NULL;--> statement-breakpoint

-- Compare against the existing enum value only. A newly added enum value
-- cannot appear in a CHECK in the same transaction that added it.
ALTER TABLE "qos"."agent_runs" ADD CONSTRAINT "agent_runs_binding_for_provider" CHECK (
  (provider = 'hyperagent' AND binding_id IS NOT NULL) OR (provider <> 'hyperagent')
);--> statement-breakpoint
