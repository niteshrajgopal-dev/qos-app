-- Menu Manager on qos_ai_worker calls menu.get_health, which reloads the
-- live draft via loadMenuFacts. 0042/0043 granted menus, locations and
-- products; the rest of that graph was missing, so the worker crashed on
-- catalogue_menu_translations. FORCE RLS on every table keeps the worker
-- tenant-isolated. UPDATE on stop-sales is only the expiry housekeeping
-- loadMenuFacts already performs on public menu reads.
GRANT SELECT ON TABLE
  qos.catalogue_menu_translations,
  qos.catalogue_menu_sections,
  qos.catalogue_menu_section_translations,
  qos.catalogue_menu_section_products,
  qos.catalogue_menu_live_revisions,
  qos.catalogue_product_translations,
  qos.catalogue_product_categories,
  qos.catalogue_variants,
  qos.catalogue_variant_prices,
  qos.catalogue_product_modifier_groups,
  qos.catalogue_modifier_groups,
  qos.catalogue_modifier_options,
  qos.catalogue_media_derivatives,
  qos.location_weekly_schedule_windows,
  qos.location_schedule_exceptions
TO qos_ai_worker;--> statement-breakpoint
GRANT SELECT, UPDATE ON TABLE qos.location_item_stop_sales TO qos_ai_worker;
