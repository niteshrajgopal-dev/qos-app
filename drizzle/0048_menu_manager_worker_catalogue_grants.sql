-- MANUAL (Nitesh): apply on every environment that runs the AI worker before
-- native / queued_worker Menu Manager reviews. Completes the catalogue SELECT
-- grants started in 0042_ai_job_queue.sql (which omitted menu translation rows).

GRANT SELECT ON TABLE
  qos.catalogue_menu_translations,
  qos.catalogue_menu_sections,
  qos.catalogue_menu_section_translations,
  qos.catalogue_menu_section_products,
  qos.catalogue_menu_live_revisions,
  qos.catalogue_product_translations,
  qos.catalogue_variants,
  qos.catalogue_variant_prices,
  qos.catalogue_modifier_groups,
  qos.catalogue_modifier_options,
  qos.catalogue_product_modifier_groups,
  qos.catalogue_product_categories,
  qos.catalogue_media_derivatives,
  qos.location_item_stop_sales,
  qos.location_weekly_schedule_windows,
  qos.location_schedule_exceptions
TO qos_ai_worker;
