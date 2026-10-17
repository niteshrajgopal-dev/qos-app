-- MANUAL (Nitesh): apply this migration before enabling catalogue.menu_extraction spend
-- and AGENT_OPENAI_TASK_MODEL_ALLOWLIST in any environment.

ALTER TYPE "qos"."agent_capability" ADD VALUE IF NOT EXISTS 'catalogue_menu_extraction';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qos"."catalogue_menu_extraction_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "public_id" text NOT NULL,
  "content_hash" text NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "original_storage_path" text NOT NULL,
  "page_count" integer NOT NULL,
  "status" text NOT NULL,
  "uploaded_by_subject" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "catalogue_menu_extraction_sources_status_check" CHECK ("status" IN ('ready', 'failed')),
  CONSTRAINT "catalogue_menu_extraction_sources_page_count_check" CHECK ("page_count" >= 1 AND "page_count" <= 32),
  CONSTRAINT "catalogue_menu_extraction_sources_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "qos"."tenants"("id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "catalogue_menu_extraction_sources_public_unique" ON "qos"."catalogue_menu_extraction_sources" USING btree ("tenant_id","public_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "catalogue_menu_extraction_sources_tenant_id_id_unique" ON "qos"."catalogue_menu_extraction_sources" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "catalogue_menu_extraction_sources_content_hash_unique" ON "qos"."catalogue_menu_extraction_sources" USING btree ("tenant_id","content_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_menu_extraction_sources_tenant_id_idx" ON "qos"."catalogue_menu_extraction_sources" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "qos"."catalogue_menu_extraction_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_menu_extraction_sources" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."catalogue_menu_extraction_sources" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "qos"."catalogue_menu_extraction_sources" TO qos_app;--> statement-breakpoint
CREATE POLICY "catalogue_menu_extraction_sources_tenant_isolation" ON "qos"."catalogue_menu_extraction_sources"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qos"."catalogue_menu_extraction_pages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "source_id" uuid NOT NULL,
  "page_number" integer NOT NULL,
  "storage_path" text NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "content_hash" text NOT NULL,
  CONSTRAINT "catalogue_menu_extraction_pages_page_number_check" CHECK ("page_number" >= 1),
  CONSTRAINT "catalogue_menu_extraction_pages_source_fk" FOREIGN KEY ("tenant_id","source_id") REFERENCES "qos"."catalogue_menu_extraction_sources"("tenant_id","id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "catalogue_menu_extraction_pages_source_page_unique" ON "qos"."catalogue_menu_extraction_pages" USING btree ("tenant_id","source_id","page_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_menu_extraction_pages_tenant_id_idx" ON "qos"."catalogue_menu_extraction_pages" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "qos"."catalogue_menu_extraction_pages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_menu_extraction_pages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."catalogue_menu_extraction_pages" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "qos"."catalogue_menu_extraction_pages" TO qos_app;--> statement-breakpoint
CREATE POLICY "catalogue_menu_extraction_pages_tenant_isolation" ON "qos"."catalogue_menu_extraction_pages"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qos"."catalogue_menu_extraction_candidates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "agent_run_id" uuid NOT NULL,
  "candidate_key" text NOT NULL,
  "section_name" text,
  "payload" jsonb NOT NULL,
  "excluded" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "catalogue_menu_extraction_candidates_run_fk" FOREIGN KEY ("tenant_id","agent_run_id") REFERENCES "qos"."agent_runs"("tenant_id","id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "catalogue_menu_extraction_candidates_run_key_unique" ON "qos"."catalogue_menu_extraction_candidates" USING btree ("tenant_id","agent_run_id","candidate_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogue_menu_extraction_candidates_tenant_id_idx" ON "qos"."catalogue_menu_extraction_candidates" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "qos"."catalogue_menu_extraction_candidates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_menu_extraction_candidates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."catalogue_menu_extraction_candidates" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "qos"."catalogue_menu_extraction_candidates" TO qos_app;--> statement-breakpoint
CREATE POLICY "catalogue_menu_extraction_candidates_tenant_isolation" ON "qos"."catalogue_menu_extraction_candidates"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qos"."agent_run_catalogue_menu_extraction_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "agent_run_id" uuid NOT NULL,
  "decision" text NOT NULL,
  "import_operation_public_id" text,
  "decided_by_subject" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_run_catalogue_menu_extraction_decisions_decision_check" CHECK ("decision" IN ('confirmed', 'rejected', 'cancelled')),
  CONSTRAINT "agent_run_catalogue_menu_extraction_decisions_run_fk" FOREIGN KEY ("tenant_id","agent_run_id") REFERENCES "qos"."agent_runs"("tenant_id","id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_run_catalogue_menu_extraction_decisions_run_unique" ON "qos"."agent_run_catalogue_menu_extraction_decisions" USING btree ("tenant_id","agent_run_id");--> statement-breakpoint
ALTER TABLE "qos"."agent_run_catalogue_menu_extraction_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."agent_run_catalogue_menu_extraction_decisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."agent_run_catalogue_menu_extraction_decisions" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "qos"."agent_run_catalogue_menu_extraction_decisions" TO qos_app;--> statement-breakpoint
CREATE POLICY "agent_run_catalogue_menu_extraction_decisions_tenant_isolation" ON "qos"."agent_run_catalogue_menu_extraction_decisions"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT ON TABLE "qos"."catalogue_menu_extraction_sources", "qos"."catalogue_menu_extraction_pages" TO qos_ai_worker;--> statement-breakpoint
CREATE POLICY "catalogue_menu_extraction_sources_worker_select" ON "qos"."catalogue_menu_extraction_sources"
  FOR SELECT
  TO qos_ai_worker
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "catalogue_menu_extraction_pages_worker_select" ON "qos"."catalogue_menu_extraction_pages"
  FOR SELECT
  TO qos_ai_worker
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "qos"."catalogue_menu_extraction_candidates" TO qos_ai_worker;--> statement-breakpoint
CREATE POLICY "catalogue_menu_extraction_candidates_worker_select" ON "qos"."catalogue_menu_extraction_candidates"
  FOR SELECT
  TO qos_ai_worker
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "catalogue_menu_extraction_candidates_worker_insert" ON "qos"."catalogue_menu_extraction_candidates"
  FOR INSERT
  TO qos_ai_worker
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);
