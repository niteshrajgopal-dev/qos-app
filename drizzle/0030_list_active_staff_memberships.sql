CREATE OR REPLACE FUNCTION qos.list_active_staff_memberships(p_subject text)
RETURNS TABLE (
  tenant_id uuid,
  tenant_public_id text,
  tenant_name text,
  membership_id uuid,
  role qos.staff_role
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = qos
AS $$
  SELECT
    sm.tenant_id,
    t.public_id,
    t.name,
    sm.id,
    sm.role
  FROM qos.staff_identities si
  INNER JOIN qos.staff_memberships sm ON sm.staff_identity_id = si.id
  INNER JOIN qos.tenants t ON t.id = sm.tenant_id
  WHERE si.provider_subject = p_subject
    AND sm.status = 'active';
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION qos.list_active_staff_memberships(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION qos.list_active_staff_memberships(text) TO qos_app;--> statement-breakpoint
DROP FUNCTION IF EXISTS qos.ensure_staff_identity(text, text);--> statement-breakpoint
CREATE OR REPLACE FUNCTION qos.ensure_staff_identity(p_subject text, p_email text)
RETURNS TABLE (
  identity_id uuid,
  identity_subject text,
  identity_email text,
  identity_created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = qos
AS $$
BEGIN
  INSERT INTO qos.staff_identities (provider_subject, email)
  VALUES (p_subject, p_email)
  ON CONFLICT (provider_subject) DO UPDATE
    SET email = excluded.email
    WHERE qos.staff_identities.email IS DISTINCT FROM excluded.email;

  RETURN QUERY
  SELECT si.id, si.provider_subject, si.email, si.created_at
  FROM qos.staff_identities si
  WHERE si.provider_subject = p_subject;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION qos.ensure_staff_identity(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION qos.ensure_staff_identity(text, text) TO qos_app;
