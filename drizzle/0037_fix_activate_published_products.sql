-- Migration: Fix activation of products in published menus (fixes 0036)
-- Migration 0036 used the wrong JSON path: it treated 'products' as a single object
-- instead of an array. This migration uses the correct double jsonb_array_elements
-- to first iterate sections, then iterate products within each section.
-- Idempotent, tenant-scoped, skips archived products.

WITH published_product_ids AS (
  SELECT DISTINCT
    r.tenant_id,
    jsonb_array_elements(
      jsonb_array_elements(r.payload->'sections')->'products'
    )->>'productPublicId' AS product_public_id
  FROM qos.catalogue_menu_live_revisions r
)
UPDATE qos.catalogue_products p
SET 
  status = 'active',
  updated_at = NOW()
FROM published_product_ids pub
WHERE
  p.tenant_id = pub.tenant_id
  AND p.public_id = pub.product_public_id
  AND p.status = 'draft';
