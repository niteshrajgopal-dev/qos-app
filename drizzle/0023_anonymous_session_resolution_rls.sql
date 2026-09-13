CREATE POLICY storefront_anonymous_sessions_public_resolution ON qos.storefront_anonymous_sessions
  FOR SELECT
  TO qos_app
  USING (coalesce(nullif(current_setting('qos.current_tenant_id', true), ''), '') = '');
