-- MANUAL (Nitesh): QOS-200 Phase 2 workbook apply handlers. Apply with the
-- admin connection after 0064 and before deploying the matching web/API image.
-- Journal `when` is 1793800000000 (after 0064's 1793700000000).
-- One change to an existing table: the typed workbook source-link entity CHECK
-- (0058) is widened so units, suppliers, warehouses, inventory categories,
-- inventory items, recipe families, recipe versions, recipe lines, prep steps
-- and modifier effects get durable workbook identity. No new table, no grant,
-- RLS or policy change, no seeded rows and no data change; existing links keep
-- their values. Nothing here posts stock or production.

ALTER TABLE "qos"."workbook_source_links" DROP CONSTRAINT IF EXISTS "workbook_source_links_entity_check";--> statement-breakpoint
ALTER TABLE "qos"."workbook_source_links" ADD CONSTRAINT "workbook_source_links_entity_check" CHECK ("entity_type" IN ('category','product','variant','modifier_group','modifier_option','menu','menu_section','unit','supplier','warehouse','inventory_category','inventory_item','recipe','recipe_version','recipe_line','prep_step','modifier_effect'));

-- Down script (documentation only; not executed). Roll the application back first,
-- then run with the admin connection and delete the idx 65 row from
-- drizzle.__drizzle_migrations if it was recorded. The DELETE removes only the
-- Phase 2 workbook identities this migration allowed; the records they point at stay:
--   DELETE FROM "qos"."workbook_source_links" WHERE "entity_type" NOT IN ('category','product','variant','modifier_group','modifier_option','menu','menu_section');
--   ALTER TABLE "qos"."workbook_source_links" DROP CONSTRAINT IF EXISTS "workbook_source_links_entity_check";
--   ALTER TABLE "qos"."workbook_source_links" ADD CONSTRAINT "workbook_source_links_entity_check" CHECK ("entity_type" IN ('category','product','variant','modifier_group','modifier_option','menu','menu_section'));
