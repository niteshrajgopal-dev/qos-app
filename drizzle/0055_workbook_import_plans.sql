-- MANUAL (Nitesh): QOS-194 persisted workbook review plans. Review only: nothing here writes a catalogue record. QOS-217 consumes a plan for apply after recomputing its plan_hash. Two new tables, RLS (ENABLE + FORCE), tenant isolation policies, SELECT/INSERT/UPDATE for qos_app (no DELETE: rows are revised in place, never removed). Number 0055 per MIGRATION-NUMBERS.txt (0054 is reserved for QOS-212).
CREATE TABLE IF NOT EXISTS "qos"."workbook_import_plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "public_id" text NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "status" text NOT NULL,
  "source_profile" text NOT NULL,
  "template_version" text NOT NULL,
  "dictionary_version" text,
  "brand_id" uuid NOT NULL,
  "source_namespace" text NOT NULL,
  "keys_verified" boolean NOT NULL,
  "file_name" text NOT NULL,
  "file_fingerprint" text NOT NULL,
  "source_file_sha256" text,
  "export_revision" text,
  "snapshot_hash" text NOT NULL,
  "plan_hash" text NOT NULL,
  "engine_version" text NOT NULL,
  "created_by_subject" text NOT NULL,
  "created_by_role" text NOT NULL,
  "reviewed_by_subject" text NOT NULL,
  "branch_scope" jsonb NOT NULL,
  "context" jsonb NOT NULL,
  "counts" jsonb NOT NULL,
  "decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workbook_import_plans_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "qos"."tenants"("id") ON DELETE restrict,
  CONSTRAINT "workbook_import_plans_brand_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "qos"."brands"("tenant_id","id") ON DELETE restrict,
  CONSTRAINT "workbook_import_plans_status_check" CHECK ("status" IN ('review_ready','stale')),
  CONSTRAINT "workbook_import_plans_profile_check" CHECK ("source_profile" IN ('qos_extended_v1','foodics_menu_v1')),
  CONSTRAINT "workbook_import_plans_role_check" CHECK ("created_by_role" IN ('administrator','user')),
  CONSTRAINT "workbook_import_plans_revision_check" CHECK ("revision" >= 1)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workbook_import_plans_public_unique" ON "qos"."workbook_import_plans" USING btree ("tenant_id","public_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workbook_import_plans_tenant_id_id_unique" ON "qos"."workbook_import_plans" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workbook_import_plans_idempotency_unique" ON "qos"."workbook_import_plans" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workbook_import_plans_tenant_id_idx" ON "qos"."workbook_import_plans" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "qos"."workbook_import_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."workbook_import_plans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."workbook_import_plans" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "qos"."workbook_import_plans" TO qos_app;--> statement-breakpoint
CREATE POLICY "workbook_import_plans_tenant_isolation" ON "qos"."workbook_import_plans"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qos"."workbook_import_plan_rows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "plan_id" uuid NOT NULL,
  "sheet" text NOT NULL,
  "row_number" integer NOT NULL,
  "entity_key" text NOT NULL,
  "requested_action" text NOT NULL,
  "classification" text NOT NULL,
  "operation" text,
  "target_public_id" text,
  "target_revision" text,
  "values" jsonb NOT NULL,
  "before" jsonb,
  "after" jsonb,
  "changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "deferred_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "diagnostics" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "dependencies" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "provenance" jsonb,
  "decision" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workbook_import_plan_rows_plan_fk" FOREIGN KEY ("tenant_id","plan_id") REFERENCES "qos"."workbook_import_plans"("tenant_id","id") ON DELETE restrict,
  CONSTRAINT "workbook_import_plan_rows_row_check" CHECK ("row_number" >= 1),
  CONSTRAINT "workbook_import_plan_rows_classification_check" CHECK ("classification" IN ('create','update','unchanged','skipped','conflicting','invalid','blocked','unsupported')),
  CONSTRAINT "workbook_import_plan_rows_operation_check" CHECK ("operation" IS NULL OR "operation" IN ('create','update','archive','restore','remove_link','reset_to_central'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workbook_import_plan_rows_unique" ON "qos"."workbook_import_plan_rows" USING btree ("tenant_id","plan_id","sheet","row_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workbook_import_plan_rows_plan_idx" ON "qos"."workbook_import_plan_rows" USING btree ("tenant_id","plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workbook_import_plan_rows_tenant_id_idx" ON "qos"."workbook_import_plan_rows" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "qos"."workbook_import_plan_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."workbook_import_plan_rows" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."workbook_import_plan_rows" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "qos"."workbook_import_plan_rows" TO qos_app;--> statement-breakpoint
CREATE POLICY "workbook_import_plan_rows_tenant_isolation" ON "qos"."workbook_import_plan_rows"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);
-- Down script (documentation only; not executed by the migrator). Run manually with the admin connection, then delete the
-- idx 55 row from drizzle.__drizzle_migrations if you also want the migrator to re-apply it:
--   DROP TABLE IF EXISTS "qos"."workbook_import_plan_rows";
--   DROP TABLE IF EXISTS "qos"."workbook_import_plans";
