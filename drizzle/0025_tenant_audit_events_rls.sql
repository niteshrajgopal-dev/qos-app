ALTER TABLE qos.tenant_audit_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.tenant_audit_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE qos.tenant_audit_events FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE qos.tenant_audit_events TO qos_app;--> statement-breakpoint
CREATE POLICY tenant_audit_events_tenant_select ON qos.tenant_audit_events
  FOR SELECT
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY tenant_audit_events_tenant_insert ON qos.tenant_audit_events
  FOR INSERT
  TO qos_app
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);
