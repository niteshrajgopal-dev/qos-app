CREATE POLICY catalogue_menu_public_links_public_resolution ON qos.catalogue_menu_public_links
  FOR SELECT
  TO qos_app
  USING (coalesce(nullif(current_setting('qos.current_tenant_id', true), ''), '') = '');
