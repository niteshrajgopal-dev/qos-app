CREATE POLICY storefronts_public_resolution ON qos.storefronts
  FOR SELECT
  TO qos_app
  USING (coalesce(nullif(current_setting('qos.current_tenant_id', true), ''), '') = '');--> statement-breakpoint
CREATE POLICY storefront_domains_public_resolution ON qos.storefront_domains
  FOR SELECT
  TO qos_app
  USING (coalesce(nullif(current_setting('qos.current_tenant_id', true), ''), '') = '');
