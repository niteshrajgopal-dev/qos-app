-- QOS-89 post-import spot checks (read-only).
-- Usage (never echo connection string in shell history if avoidable):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/sql/verify-quotes-hbz-finedine-import.sql

\echo '=== Price spot-checks (Quotes tenant) ==='
SELECT cpt.display_name,
       cvp.amount_minor,
       cvp.currency
FROM qos.tenants t
JOIN qos.catalogue_product_translations cpt
  ON cpt.tenant_id = t.id
JOIN qos.catalogue_products cp
  ON cp.tenant_id = t.id
 AND cp.id = cpt.product_id
JOIN qos.catalogue_variants cv
  ON cv.tenant_id = t.id
 AND cv.product_id = cp.id
 AND cv.is_default = true
JOIN qos.catalogue_variant_prices cvp
  ON cvp.tenant_id = t.id
 AND cvp.variant_id = cv.id
WHERE t.public_id = 'ten_quotes_dev'
  AND cpt.display_name IN ('Flatwhite', 'Flat White', 'Heaven Pie', 'Vegan Lentil Soup')
ORDER BY cpt.display_name;

\echo '=== Draft menu (hbz-stadium-finedine) ==='
SELECT cm.public_id,
       cm.internal_name,
       cm.status,
       cm.version,
       cm.published_version
FROM qos.tenants t
JOIN qos.catalogue_menus cm
  ON cm.tenant_id = t.id
WHERE t.public_id = 'ten_quotes_dev'
  AND cm.internal_name = 'hbz-stadium-finedine';

\echo '=== Menu location bindings ==='
SELECT l.public_id AS location_public_id,
       l.slug AS location_slug
FROM qos.tenants t
JOIN qos.catalogue_menus cm
  ON cm.tenant_id = t.id
 AND cm.internal_name = 'hbz-stadium-finedine'
JOIN qos.catalogue_menu_locations cml
  ON cml.tenant_id = t.id
 AND cml.menu_id = cm.id
JOIN qos.locations l
  ON l.tenant_id = t.id
 AND l.id = cml.location_id
WHERE t.public_id = 'ten_quotes_dev'
ORDER BY l.public_id;

\echo '=== Flower tenant — HBZ FineDine import links (expect 0) ==='
SELECT count(*) AS finedine_import_link_count
FROM qos.tenants t
JOIN qos.catalogue_import_source_links cisl
  ON cisl.tenant_id = t.id
WHERE t.public_id = 'ten_flowers_dev'
  AND cisl.connection_key = 'finedine.hbz-stadium';

\echo '=== Other Quotes locations — sec_fd_* sections (expect 0) ==='
SELECT l.public_id AS location_public_id,
       count(cms.id) AS sec_fd_section_count
FROM qos.tenants t
JOIN qos.locations l
  ON l.tenant_id = t.id
 AND l.public_id IN ('loc_quotes_hct')
LEFT JOIN qos.catalogue_menu_locations cml
  ON cml.tenant_id = t.id
 AND cml.location_id = l.id
LEFT JOIN qos.catalogue_menus cm
  ON cm.tenant_id = t.id
 AND cm.id = cml.menu_id
LEFT JOIN qos.catalogue_menu_sections cms
  ON cms.tenant_id = t.id
 AND cms.menu_id = cm.id
 AND cms.public_id LIKE 'sec_fd_%'
WHERE t.public_id = 'ten_quotes_dev'
GROUP BY l.public_id
ORDER BY l.public_id;
