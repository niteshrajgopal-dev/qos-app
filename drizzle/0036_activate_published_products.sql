-- Migration: Activate products that are in published menus but still marked as draft
-- This idempotently moves catalogue_products.status from 'draft' to 'active'
-- for products that appear in at least one published menu (catalogue_menu_live_revisions.payload).
-- It does NOT touch archived products or products not in any published menu.

-- Extract product public IDs from the live revision payloads (what customers actually see)
WITH published_product_ids AS (
  SELECT DISTINCT
    jsonb_array_elements(
      jsonb_array_elements(payload->'sections')->'products'
    )->>'productPublicId' AS product_public_id
  FROM qos.catalogue_menu_live_revisions
)
UPDATE qos.catalogue_products
SET 
  status = 'active',
  updated_at = NOW()
WHERE
  status = 'draft'
  AND public_id IN (SELECT product_public_id FROM published_product_ids);
