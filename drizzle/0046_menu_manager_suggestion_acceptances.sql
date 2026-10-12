CREATE TABLE IF NOT EXISTS "qos"."agent_run_menu_manager_suggestion_acceptances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "agent_run_id" uuid NOT NULL,
  "product_public_id" text NOT NULL,
  "field" text NOT NULL,
  "proposed_text" text NOT NULL,
  "accepted_by_subject" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_run_menu_manager_suggestion_acceptances_run_fk" FOREIGN KEY ("tenant_id","agent_run_id") REFERENCES "qos"."agent_runs"("tenant_id","id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "agent_run_menu_manager_suggestion_acceptances_field_check" CHECK ("field" IN ('name_en', 'description_en', 'name_ar', 'description_ar')),
  CONSTRAINT "agent_run_menu_manager_suggestion_acceptances_proposed_text_len" CHECK (char_length("proposed_text") BETWEEN 1 AND 2000)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_run_menu_manager_suggestion_acceptances_identity_unique" ON "qos"."agent_run_menu_manager_suggestion_acceptances" USING btree ("tenant_id","agent_run_id","product_public_id","field","proposed_text");--> statement-breakpoint
ALTER TABLE "qos"."agent_run_menu_manager_suggestion_acceptances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."agent_run_menu_manager_suggestion_acceptances" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."agent_run_menu_manager_suggestion_acceptances" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "qos"."agent_run_menu_manager_suggestion_acceptances" TO qos_app;--> statement-breakpoint
CREATE POLICY "agent_run_menu_manager_suggestion_acceptances_tenant_isolation" ON "qos"."agent_run_menu_manager_suggestion_acceptances"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);
