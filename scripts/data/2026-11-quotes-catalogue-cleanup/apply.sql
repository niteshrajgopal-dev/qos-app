-- Quotes catalogue cleanup (2026-11): archive QA junk and duplicate products.
--
-- Manual, reviewed, owner-run data script. Never run from CI or migrations.
-- Archives only (status -> 'archived'); never deletes. Every archive writes a
-- tenant audit event carrying the previous status, which rollback.sql reads.
--
-- Targets, matched on the product's English name (internal name when the
-- English translation is missing), non-archived products in one tenant only:
--   formula_test_row  name is '=SUM(1,2)' (optionally with the leading
--                     apostrophe CSV export adds), any case/spacing.
--                     Every match is archived.
--   single_espresso   name is 'Single Espresso', any case.
--   flat_white        name is 'Flat White' ignoring case and spaces
--                     (so 'Flatwhite' and 'Flat White' are one group).
--                     One survivor is kept per group, the rest archived.
--
-- Survivor rule (first wins): referenced by a published menu revision, then
-- by a non-archived menu draft, then status 'active', then oldest, then
-- lowest public id. A row that appears in a published menu revision is never
-- archived: if two rows in a group are published the whole group is skipped
-- for a person to resolve, and a published '=SUM(1,2)' row is skipped too.
--
-- Usage (preview is the default and changes nothing):
--   PGOPTIONS="-c qos.cleanup_tenant_id=<quotes tenant uuid>" \
--     psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f apply.sql
--   PGOPTIONS="-c qos.cleanup_tenant_id=<uuid> -c qos.cleanup_mode=apply" \
--     psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f apply.sql
-- Re-running after an apply finds nothing left to archive.

BEGIN;

DO $guard$
DECLARE
  v_tenant uuid := nullif(current_setting('qos.cleanup_tenant_id', true), '')::uuid;
  v_mode text := coalesce(nullif(current_setting('qos.cleanup_mode', true), ''), 'preview');
  v_name text;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Set qos.cleanup_tenant_id to the Quotes tenant id.';
  END IF;
  IF v_mode NOT IN ('preview', 'apply') THEN
    RAISE EXCEPTION 'qos.cleanup_mode must be preview or apply, not %.', v_mode;
  END IF;
  PERFORM set_config('qos.current_tenant_id', v_tenant::text, true);
  SELECT name INTO v_name FROM qos.tenants WHERE id = v_tenant;
  IF v_name IS DISTINCT FROM 'Quotes' THEN
    RAISE EXCEPTION 'Tenant % is %, not Quotes. Nothing changed.', v_tenant, coalesce(v_name, 'missing');
  END IF;
  RAISE NOTICE 'quotes-catalogue-cleanup-2026-11: % mode for tenant %', v_mode, v_tenant;
END
$guard$;

CREATE TEMP TABLE quotes_cleanup_plan ON COMMIT DROP AS
WITH params AS (
  SELECT current_setting('qos.cleanup_tenant_id')::uuid AS tenant_id
),
named AS (
  SELECT
    p.id,
    p.tenant_id,
    p.public_id,
    p.status,
    p.version,
    p.created_at,
    coalesce(nullif(btrim(en.display_name), ''), p.internal_name) AS name
  FROM qos.catalogue_products p
  JOIN params ON p.tenant_id = params.tenant_id
  LEFT JOIN qos.catalogue_product_translations en
    ON en.tenant_id = p.tenant_id AND en.product_id = p.id AND en.locale = 'en'
  WHERE p.status <> 'archived'
),
targeted AS (
  SELECT
    n.*,
    CASE
      WHEN upper(regexp_replace(ltrim(btrim(n.name), ''''), '\s+', '', 'g')) = '=SUM(1,2)'
        THEN 'formula_test_row'
      WHEN lower(regexp_replace(btrim(n.name), '\s+', ' ', 'g')) = 'single espresso'
        THEN 'single_espresso'
      WHEN lower(regexp_replace(n.name, '\s+', '', 'g')) = 'flatwhite'
        THEN 'flat_white'
    END AS target
  FROM named n
),
live_refs AS (
  SELECT t.id, count(DISTINCT r.id) AS live_revisions
  FROM targeted t
  JOIN qos.catalogue_menu_live_revisions r
    ON r.tenant_id = t.tenant_id
   AND EXISTS (
     SELECT 1
     FROM jsonb_array_elements(r.payload -> 'sections') AS section,
          jsonb_array_elements(section -> 'products') AS product
     WHERE product ->> 'productPublicId' = t.public_id
   )
  WHERE t.target IS NOT NULL
  GROUP BY t.id
),
draft_refs AS (
  SELECT t.id, count(DISTINCT m.id) AS draft_menus
  FROM targeted t
  JOIN qos.catalogue_menu_section_products sp
    ON sp.tenant_id = t.tenant_id AND sp.product_id = t.id AND NOT sp.archived
  JOIN qos.catalogue_menu_sections s
    ON s.tenant_id = sp.tenant_id AND s.id = sp.section_id AND NOT s.archived
  JOIN qos.catalogue_menus m
    ON m.tenant_id = s.tenant_id AND m.id = s.menu_id AND m.status <> 'archived'
  WHERE t.target IS NOT NULL
  GROUP BY t.id
),
ranked AS (
  SELECT
    t.*,
    coalesce(l.live_revisions, 0) AS live_revisions,
    coalesce(d.draft_menus, 0) AS draft_menus,
    row_number() OVER survivor_order AS rank,
    first_value(t.public_id) OVER survivor_order AS survivor_public_id,
    count(*) OVER (PARTITION BY t.target) AS group_size,
    count(*) FILTER (WHERE coalesce(l.live_revisions, 0) > 0)
      OVER (PARTITION BY t.target) AS live_in_group
  FROM targeted t
  LEFT JOIN live_refs l ON l.id = t.id
  LEFT JOIN draft_refs d ON d.id = t.id
  WHERE t.target IS NOT NULL
  WINDOW survivor_order AS (
    PARTITION BY t.target
    ORDER BY
      (coalesce(l.live_revisions, 0) > 0) DESC,
      (coalesce(d.draft_menus, 0) > 0) DESC,
      (t.status = 'active') DESC,
      t.created_at ASC,
      t.public_id ASC
  )
)
SELECT
  ranked.*,
  CASE
    WHEN target = 'formula_test_row' AND live_revisions > 0 THEN 'skip_published'
    WHEN target = 'formula_test_row' THEN 'archive'
    WHEN group_size = 1 THEN 'keep'
    WHEN live_in_group > 1 THEN 'skip_ambiguous'
    WHEN rank = 1 THEN 'keep'
    ELSE 'archive'
  END AS decision
FROM ranked;

CREATE TEMP TABLE quotes_cleanup_run ON COMMIT DROP AS
SELECT
  gen_random_uuid() AS correlation_id,
  coalesce(nullif(current_setting('qos.cleanup_mode', true), ''), 'preview') AS mode;

SELECT
  target,
  decision,
  public_id,
  name,
  status,
  live_revisions,
  draft_menus,
  created_at,
  CASE WHEN target = 'formula_test_row' THEN NULL ELSE survivor_public_id END AS survivor
FROM quotes_cleanup_plan
ORDER BY target, rank;

WITH archived AS (
  UPDATE qos.catalogue_products p
  SET status = 'archived', version = p.version + 1, updated_at = now()
  FROM quotes_cleanup_plan plan, quotes_cleanup_run run
  WHERE run.mode = 'apply'
    AND plan.decision = 'archive'
    AND p.id = plan.id
    AND p.status = plan.status
    AND p.version = plan.version
  RETURNING
    p.tenant_id,
    p.public_id,
    p.version,
    plan.status AS previous_status,
    plan.target,
    CASE WHEN plan.target = 'formula_test_row' THEN NULL ELSE plan.survivor_public_id END
      AS survivor_public_id
)
INSERT INTO qos.tenant_audit_events (
  tenant_id, actor_subject, actor_class, action, entity_type,
  entity_public_id, entity_version, correlation_id, change_summary
)
SELECT
  a.tenant_id,
  'data-script:quotes-catalogue-cleanup-2026-11',
  'operator',
  'catalogue.product.archived',
  'catalogue_product',
  a.public_id,
  a.version,
  run.correlation_id,
  jsonb_build_object(
    'dataScript', 'quotes-catalogue-cleanup-2026-11',
    'previousStatus', a.previous_status,
    'status', 'archived',
    'reason', a.target,
    'survivorPublicId', a.survivor_public_id
  )
FROM archived a, quotes_cleanup_run run;

DO $verify$
DECLARE
  v_mode text;
  v_planned integer;
  v_done integer;
BEGIN
  SELECT mode INTO v_mode FROM quotes_cleanup_run;
  SELECT count(*) INTO v_planned FROM quotes_cleanup_plan WHERE decision = 'archive';
  SELECT count(*) INTO v_done
  FROM qos.tenant_audit_events e, quotes_cleanup_run run
  WHERE e.correlation_id = run.correlation_id;
  IF v_mode = 'apply' AND v_done <> v_planned THEN
    RAISE EXCEPTION 'Planned % archives but made %; rows changed during the run. Rolled back.', v_planned, v_done;
  END IF;
  RAISE NOTICE 'quotes-catalogue-cleanup-2026-11: % row(s) % archived.',
    CASE WHEN v_mode = 'apply' THEN v_done ELSE v_planned END,
    CASE WHEN v_mode = 'apply' THEN 'were' ELSE 'would be' END;
END
$verify$;

COMMIT;
