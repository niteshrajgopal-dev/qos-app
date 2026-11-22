-- MANUAL (Nitesh): QOS-217 workbook apply. Widens the 0055 plan status, adds per-row apply checkpoints, one table for apply attempts (idempotency, history, recovery) and one for typed source links (identity for reimports). RLS (ENABLE + FORCE), tenant isolation policies, SELECT/INSERT/UPDATE for qos_app (no DELETE). Number 0058 per MIGRATION-NUMBERS.txt (0054 QOS-212, 0055 QOS-194, 0056 QOS-213, 0057 QOS-214, 0059 reserved for QOS-215). Apply after 0057.
ALTER TABLE "qos"."workbook_import_plans" DROP CONSTRAINT IF EXISTS "workbook_import_plans_status_check";--> statement-breakpoint
ALTER TABLE "qos"."workbook_import_plans" ADD CONSTRAINT "workbook_import_plans_status_check"
  CHECK ("status" IN ('review_ready','stale','applying','applied','apply_failed'));--> statement-breakpoint
ALTER TABLE "qos"."workbook_import_plan_rows"
  ADD COLUMN IF NOT EXISTS "apply_state" text,
  ADD COLUMN IF NOT EXISTS "applied_public_id" text,
  ADD COLUMN IF NOT EXISTS "applied_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "apply_id" uuid,
  ADD COLUMN IF NOT EXISTS "apply_error" jsonb,
  ADD COLUMN IF NOT EXISTS "apply_result" jsonb;--> statement-breakpoint
ALTER TABLE "qos"."workbook_import_plan_rows" ADD CONSTRAINT "workbook_import_plan_rows_apply_state_check"
  CHECK ("apply_state" IS NULL OR "apply_state" IN ('pending','applied','already_applied','failed','not_applied','deferred_only'));--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qos"."workbook_import_applies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "plan_id" uuid NOT NULL,
  "public_id" text NOT NULL,
  "status" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "plan_revision" integer NOT NULL,
  "plan_hash" text NOT NULL,
  "snapshot_hash" text NOT NULL,
  "engine_version" text NOT NULL,
  "source_profile" text NOT NULL,
  "source_namespace" text NOT NULL,
  "template_version" text NOT NULL,
  "dictionary_version" text,
  "branch_scope" jsonb NOT NULL,
  "actor_subject" text NOT NULL,
  "actor_role" text NOT NULL,
  "counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workbook_import_applies_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "qos"."tenants"("id") ON DELETE restrict,
  CONSTRAINT "workbook_import_applies_plan_fk" FOREIGN KEY ("tenant_id","plan_id") REFERENCES "qos"."workbook_import_plans"("tenant_id","id") ON DELETE restrict,
  CONSTRAINT "workbook_import_applies_status_check" CHECK ("status" IN ('applying','completed','failed','interrupted')),
  CONSTRAINT "workbook_import_applies_role_check" CHECK ("actor_role" IN ('administrator','user'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workbook_import_applies_public_unique" ON "qos"."workbook_import_applies" USING btree ("tenant_id","public_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workbook_import_applies_tenant_id_id_unique" ON "qos"."workbook_import_applies" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workbook_import_applies_idempotency_unique" ON "qos"."workbook_import_applies" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workbook_import_applies_one_running_per_plan" ON "qos"."workbook_import_applies" USING btree ("tenant_id","plan_id") WHERE "status" = 'applying';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workbook_import_applies_plan_idx" ON "qos"."workbook_import_applies" USING btree ("tenant_id","plan_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workbook_import_applies_tenant_id_idx" ON "qos"."workbook_import_applies" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "qos"."workbook_import_applies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."workbook_import_applies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."workbook_import_applies" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "qos"."workbook_import_applies" TO qos_app;--> statement-breakpoint
CREATE POLICY "workbook_import_applies_tenant_isolation" ON "qos"."workbook_import_applies"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "qos"."workbook_import_plan_rows" ADD CONSTRAINT "workbook_import_plan_rows_apply_fk"
  FOREIGN KEY ("tenant_id","apply_id") REFERENCES "qos"."workbook_import_applies"("tenant_id","id") ON DELETE restrict;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qos"."workbook_source_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "source_namespace" text NOT NULL,
  "entity_type" text NOT NULL,
  "source_key" text NOT NULL,
  "target_public_id" text NOT NULL,
  "plan_id" uuid,
  "apply_id" uuid,
  "created_by_subject" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workbook_source_links_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "qos"."tenants"("id") ON DELETE restrict,
  CONSTRAINT "workbook_source_links_plan_fk" FOREIGN KEY ("tenant_id","plan_id") REFERENCES "qos"."workbook_import_plans"("tenant_id","id") ON DELETE restrict,
  CONSTRAINT "workbook_source_links_apply_fk" FOREIGN KEY ("tenant_id","apply_id") REFERENCES "qos"."workbook_import_applies"("tenant_id","id") ON DELETE restrict,
  CONSTRAINT "workbook_source_links_entity_check" CHECK ("entity_type" IN ('category','product','variant','modifier_group','modifier_option','menu','menu_section'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workbook_source_links_source_unique" ON "qos"."workbook_source_links" USING btree ("tenant_id","source_namespace","entity_type","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workbook_source_links_target_unique" ON "qos"."workbook_source_links" USING btree ("tenant_id","source_namespace","entity_type","target_public_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workbook_source_links_tenant_id_idx" ON "qos"."workbook_source_links" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "qos"."workbook_source_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."workbook_source_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."workbook_source_links" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "qos"."workbook_source_links" TO qos_app;--> statement-breakpoint
CREATE POLICY "workbook_source_links_tenant_isolation" ON "qos"."workbook_source_links"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);
-- Down script (documentation only; not executed by the migrator). Run manually with the admin connection, then delete the
-- idx 58 row from drizzle.__drizzle_migrations if you also want the migrator to re-apply it:
--   DROP TABLE IF EXISTS "qos"."workbook_source_links";
--   ALTER TABLE "qos"."workbook_import_plan_rows" DROP CONSTRAINT IF EXISTS "workbook_import_plan_rows_apply_fk";
--   ALTER TABLE "qos"."workbook_import_plan_rows" DROP CONSTRAINT IF EXISTS "workbook_import_plan_rows_apply_state_check";
--   ALTER TABLE "qos"."workbook_import_plan_rows" DROP COLUMN IF EXISTS "apply_state", DROP COLUMN IF EXISTS "applied_public_id",
--     DROP COLUMN IF EXISTS "applied_at", DROP COLUMN IF EXISTS "apply_id", DROP COLUMN IF EXISTS "apply_error", DROP COLUMN IF EXISTS "apply_result";
--   DROP TABLE IF EXISTS "qos"."workbook_import_applies";
--   UPDATE "qos"."workbook_import_plans" SET status = 'stale' WHERE status NOT IN ('review_ready','stale');
--   ALTER TABLE "qos"."workbook_import_plans" DROP CONSTRAINT IF EXISTS "workbook_import_plans_status_check";
--   ALTER TABLE "qos"."workbook_import_plans" ADD CONSTRAINT "workbook_import_plans_status_check" CHECK ("status" IN ('review_ready','stale'));
