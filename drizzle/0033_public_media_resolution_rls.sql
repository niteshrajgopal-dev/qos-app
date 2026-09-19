CREATE POLICY catalogue_media_derivatives_public_resolution ON qos.catalogue_media_derivatives
  FOR SELECT
  TO qos_app
  USING (coalesce(nullif(current_setting('qos.current_tenant_id', true), ''), '') = '');
