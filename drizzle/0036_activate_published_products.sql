-- Migration: Activate products that are in published menus but still marked as draft
-- This idempotently moves catalogue_products.status from 'draft' to 'active'
-- for products that appear in at least one published menu (catalogue_menu_live_revisions).
-- It does NOT touch archived products or products not in any published menu.

UPDATE qos.catalogue_products
SET 
  status = 'active',
  updated_at = NOW()
WHERE
  -- Only draft products
  status = 'draft'
  -- Only products in this tenant (redundant but explicit)
  AND tenant_id IS NOT NULL
  -- Only products that are in at least one published menu
  AND id IN (
    SELECT DISTINCT cp.id
    FROM qos.catalogue_products cp
    INNER JOIN qos.catalogue_menu_section_products cmsp
      ON cmsp.tenant_id = cp.tenant_id
      AND cmsp.product_id = cp.id
    INNER JOIN qos.catalogue_menu_sections cms
      ON cms.tenant_id = cmsp.tenant_id
      AND cms.id = cmsp.section_id
    INNER JOIN qos.catalogue_menu_live_revisions cmlr
      ON cmlr.tenant_id = cms.tenant_id
      AND cmlr.menu_id = cms.menu_id
    WHERE cp.status = 'draft'
  );
