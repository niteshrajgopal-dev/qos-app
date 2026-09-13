DROP POLICY IF EXISTS business_provisioning_operations_runtime_deny ON qos.business_provisioning_operations;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE qos.business_provisioning_operations TO qos_app;--> statement-breakpoint
CREATE POLICY business_provisioning_operations_app_access ON qos.business_provisioning_operations
  FOR ALL
  TO qos_app
  USING (true)
  WITH CHECK (true);--> statement-breakpoint
CREATE POLICY tenants_operator_provision_insert ON qos.tenants
  FOR INSERT
  TO qos_app
  WITH CHECK (nullif(current_setting('qos.operator_provisioning', true), '') = 'true');
