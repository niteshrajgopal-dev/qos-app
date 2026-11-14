-- Rollback for apply.sql (quotes-catalogue-cleanup-2026-11).
--
-- Restores every product this script archived to the status recorded in its
-- archive audit event, and writes a matching 'catalogue.product.restored'
-- event. A product is only restored while it is still archived at the
-- version the script left it at; anything changed since is reported as
-- skip_changed_since and left alone. Re-running finds nothing to restore.
--
-- Usage (preview is the default and changes nothing):
--   PGOPTIONS="-c qos.cleanup_tenant_id=<quotes tenant uuid>" \
--     psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f rollback.sql
--   PGOPTIONS="-c qos.cleanup_tenant_id=<uuid> -c qos.cleanup_mode=apply" \
--     psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f rollback.sql

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
  RAISE NOTICE 'quotes-catalogue-cleanup-2026-11 rollback: % mode for tenant %', v_mode, v_tenant;
END
$guard$;

CREATE TEMP TABLE quotes_cleanup_rollback_plan ON COMMIT DROP AS
WITH latest_event AS (
  SELECT DISTINCT ON (e.entity_public_id)
    e.entity_public_id,
    e.action,
    e.entity_version,
    e.change_summary ->> 'previousStatus' AS previous_status,
    e.change_summary ->> 'reason' AS reason
  FROM qos.tenant_audit_events e
  WHERE e.tenant_id = current_setting('qos.cleanup_tenant_id')::uuid
    AND e.entity_type = 'catalogue_product'
    AND e.change_summary ->> 'dataScript' = 'quotes-catalogue-cleanup-2026-11'
  ORDER BY e.entity_public_id, e.occurred_at DESC
)
SELECT
  p.id,
  p.tenant_id,
  p.public_id,
  p.status,
  p.version,
  le.entity_version AS archived_version,
  le.previous_status,
  le.reason,
  CASE
    WHEN p.status = 'archived' AND p.version = le.entity_version THEN 'restore'
    ELSE 'skip_changed_since'
  END AS decision
FROM latest_event le
JOIN qos.catalogue_products p
  ON p.tenant_id = current_setting('qos.cleanup_tenant_id')::uuid
 AND p.public_id = le.entity_public_id
WHERE le.action = 'catalogue.product.archived'
  AND le.previous_status IN ('draft', 'active');

CREATE TEMP TABLE quotes_cleanup_rollback_run ON COMMIT DROP AS
SELECT
  gen_random_uuid() AS correlation_id,
  coalesce(nullif(current_setting('qos.cleanup_mode', true), ''), 'preview') AS mode;

SELECT reason, decision, public_id, status, previous_status AS restore_to
FROM quotes_cleanup_rollback_plan
ORDER BY reason, public_id;

WITH restored AS (
  UPDATE qos.catalogue_products p
  SET status = plan.previous_status::qos.product_status,
      version = p.version + 1,
      updated_at = now()
  FROM quotes_cleanup_rollback_plan plan, quotes_cleanup_rollback_run run
  WHERE run.mode = 'apply'
    AND plan.decision = 'restore'
    AND p.id = plan.id
    AND p.status = 'archived'
    AND p.version = plan.archived_version
  RETURNING p.tenant_id, p.public_id, p.version, plan.previous_status, plan.reason
)
INSERT INTO qos.tenant_audit_events (
  tenant_id, actor_subject, actor_class, action, entity_type,
  entity_public_id, entity_version, correlation_id, change_summary
)
SELECT
  r.tenant_id,
  'data-script:quotes-catalogue-cleanup-2026-11',
  'operator',
  'catalogue.product.restored',
  'catalogue_product',
  r.public_id,
  r.version,
  run.correlation_id,
  jsonb_build_object(
    'dataScript', 'quotes-catalogue-cleanup-2026-11',
    'previousStatus', 'archived',
    'status', r.previous_status,
    'reason', r.reason,
    'rollback', true
  )
FROM restored r, quotes_cleanup_rollback_run run;

DO $verify$
DECLARE
  v_mode text;
  v_planned integer;
  v_done integer;
BEGIN
  SELECT mode INTO v_mode FROM quotes_cleanup_rollback_run;
  SELECT count(*) INTO v_planned FROM quotes_cleanup_rollback_plan WHERE decision = 'restore';
  SELECT count(*) INTO v_done
  FROM qos.tenant_audit_events e, quotes_cleanup_rollback_run run
  WHERE e.correlation_id = run.correlation_id;
  IF v_mode = 'apply' AND v_done <> v_planned THEN
    RAISE EXCEPTION 'Planned % restores but made %; rows changed during the run. Rolled back.', v_planned, v_done;
  END IF;
  RAISE NOTICE 'quotes-catalogue-cleanup-2026-11 rollback: % row(s) % restored.',
    CASE WHEN v_mode = 'apply' THEN v_done ELSE v_planned END,
    CASE WHEN v_mode = 'apply' THEN 'were' ELSE 'would be' END;
END
$verify$;

COMMIT;
