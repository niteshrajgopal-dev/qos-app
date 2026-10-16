-- MANUAL (Nitesh): apply this migration before enabling catalogue.description spend
-- and AGENT_OPENAI_TASK_MODEL_ALLOWLIST in any environment.

ALTER TYPE "qos"."agent_capability" ADD VALUE IF NOT EXISTS 'catalogue_description';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qos"."agent_run_catalogue_description_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "agent_run_id" uuid NOT NULL,
  "decision" text NOT NULL,
  "description" text,
  "decided_by_subject" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_run_catalogue_description_decisions_decision_check" CHECK ("decision" IN ('accepted', 'rejected')),
  CONSTRAINT "agent_run_catalogue_description_decisions_description_len" CHECK ("description" IS NULL OR char_length("description") <= 4000),
  CONSTRAINT "agent_run_catalogue_description_decisions_run_fk" FOREIGN KEY ("tenant_id","agent_run_id") REFERENCES "qos"."agent_runs"("tenant_id","id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_run_catalogue_description_decisions_run_unique" ON "qos"."agent_run_catalogue_description_decisions" USING btree ("tenant_id","agent_run_id");--> statement-breakpoint
ALTER TABLE "qos"."agent_run_catalogue_description_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."agent_run_catalogue_description_decisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."agent_run_catalogue_description_decisions" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "qos"."agent_run_catalogue_description_decisions" TO qos_app;--> statement-breakpoint
CREATE POLICY "agent_run_catalogue_description_decisions_tenant_isolation" ON "qos"."agent_run_catalogue_description_decisions"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);
