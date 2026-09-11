CREATE TYPE "qos"."access_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "qos"."staff_access_request_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"access_request_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_access_request_locations_unique" UNIQUE("access_request_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "qos"."staff_access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requester_subject" text NOT NULL,
	"requester_email" text NOT NULL,
	"status" "qos"."access_request_status" DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"decided_by_subject" text,
	"decided_role" "qos"."staff_role",
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "qos"."staff_identities" ADD COLUMN "provider_subject" text;--> statement-breakpoint
UPDATE "qos"."staff_identities" SET "provider_subject" = "email" WHERE "provider_subject" IS NULL;--> statement-breakpoint
ALTER TABLE "qos"."staff_identities" ALTER COLUMN "provider_subject" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "qos"."staff_access_requests" ADD CONSTRAINT "staff_access_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "qos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."staff_access_requests" ADD CONSTRAINT "staff_access_requests_tenant_id_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "qos"."staff_access_request_locations" ADD CONSTRAINT "staff_access_request_locations_tenant_id_access_request_id_staff_access_requests_tenant_id_id_fk" FOREIGN KEY ("tenant_id","access_request_id") REFERENCES "qos"."staff_access_requests"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."staff_access_request_locations" ADD CONSTRAINT "staff_access_request_locations_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "qos"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_access_requests_tenant_id_idx" ON "qos"."staff_access_requests" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "staff_access_requests_requester_subject_idx" ON "qos"."staff_access_requests" USING btree ("requester_subject");--> statement-breakpoint
ALTER TABLE "qos"."staff_identities" ADD CONSTRAINT "staff_identities_provider_subject_unique" UNIQUE("provider_subject");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_access_requests_one_pending_per_subject" ON "qos"."staff_access_requests" ("tenant_id", "requester_subject") WHERE "status" = 'pending';--> statement-breakpoint
GRANT ALL ON TABLE qos.staff_access_requests TO qos_app;--> statement-breakpoint
GRANT ALL ON TABLE qos.staff_access_request_locations TO qos_app;--> statement-breakpoint
ALTER TABLE qos.staff_access_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.staff_access_requests FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY staff_access_requests_tenant_isolation ON qos.staff_access_requests
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.staff_access_request_locations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.staff_access_request_locations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY staff_access_request_locations_tenant_isolation ON qos.staff_access_request_locations
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE OR REPLACE FUNCTION qos.resolve_tenant_id_by_public_id(p_public_id text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = qos
AS $$
  SELECT id
  FROM qos.tenants
  WHERE public_id = p_public_id
    AND status = 'active'
  LIMIT 1;
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION qos.resolve_tenant_id_by_public_id(text) TO qos_app;--> statement-breakpoint
CREATE OR REPLACE FUNCTION qos.submit_staff_access_request(
  p_tenant_public_id text,
  p_requester_subject text,
  p_requester_email text
)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  tenant_public_id text,
  status qos.access_request_status,
  version integer,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = qos
AS $$
DECLARE
  v_tenant_id uuid;
  v_existing qos.staff_access_requests%ROWTYPE;
BEGIN
  IF coalesce(trim(p_tenant_public_id), '') = '' THEN
    RAISE EXCEPTION 'tenantPublicId is required';
  END IF;

  IF coalesce(trim(p_requester_subject), '') = '' THEN
    RAISE EXCEPTION 'requester subject is required';
  END IF;

  IF coalesce(trim(p_requester_email), '') = '' THEN
    RAISE EXCEPTION 'requester email is required';
  END IF;

  v_tenant_id := qos.resolve_tenant_id_by_public_id(trim(p_tenant_public_id));
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unknown or inactive business identifier.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM qos.staff_identities si
    INNER JOIN qos.staff_memberships sm ON sm.staff_identity_id = si.id
    WHERE si.provider_subject = trim(p_requester_subject)
      AND sm.tenant_id = v_tenant_id
      AND sm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Staff membership already exists for this business.';
  END IF;

  SELECT *
  INTO v_existing
  FROM qos.staff_access_requests sar
  WHERE sar.tenant_id = v_tenant_id
    AND sar.requester_subject = trim(p_requester_subject)
    AND sar.status = 'pending'
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY
    SELECT
      v_existing.id,
      v_existing.tenant_id,
      trim(p_tenant_public_id),
      v_existing.status,
      v_existing.version,
      v_existing.created_at;
    RETURN;
  END IF;

  RETURN QUERY
  INSERT INTO qos.staff_access_requests (
    tenant_id,
    requester_subject,
    requester_email,
    status,
    version
  )
  VALUES (
    v_tenant_id,
    trim(p_requester_subject),
    trim(p_requester_email),
    'pending',
    1
  )
  RETURNING
    staff_access_requests.id,
    staff_access_requests.tenant_id,
    trim(p_tenant_public_id),
    staff_access_requests.status,
    staff_access_requests.version,
    staff_access_requests.created_at;
END;
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION qos.submit_staff_access_request(text, text, text) TO qos_app;--> statement-breakpoint
CREATE OR REPLACE FUNCTION qos.get_staff_access_request_for_requester(
  p_request_id uuid,
  p_requester_subject text
)
RETURNS TABLE (
  id uuid,
  tenant_public_id text,
  status qos.access_request_status,
  version integer,
  decision_note text,
  created_at timestamptz,
  decided_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = qos
AS $$
  SELECT
    sar.id,
    t.public_id,
    sar.status,
    sar.version,
    sar.decision_note,
    sar.created_at,
    sar.decided_at
  FROM qos.staff_access_requests sar
  INNER JOIN qos.tenants t ON t.id = sar.tenant_id
  WHERE sar.id = p_request_id
    AND sar.requester_subject = trim(p_requester_subject);
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION qos.get_staff_access_request_for_requester(uuid, text) TO qos_app;--> statement-breakpoint
CREATE OR REPLACE FUNCTION qos.reject_staff_access_request(
  p_tenant_id uuid,
  p_request_id uuid,
  p_admin_subject text,
  p_expected_version integer,
  p_decision_note text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  status qos.access_request_status,
  version integer,
  decided_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = qos
AS $$
DECLARE
  v_request qos.staff_access_requests%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM qos.staff_identities si
    INNER JOIN qos.staff_memberships sm ON sm.staff_identity_id = si.id
    WHERE si.provider_subject = trim(p_admin_subject)
      AND sm.tenant_id = p_tenant_id
      AND sm.role = 'administrator'
      AND sm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Administrator membership required.';
  END IF;

  SELECT *
  INTO v_request
  FROM qos.staff_access_requests sar
  WHERE sar.id = p_request_id
    AND sar.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access request not found.';
  END IF;

  IF v_request.requester_subject = trim(p_admin_subject) THEN
    RAISE EXCEPTION 'Administrators cannot decide their own access request.';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Access request is no longer pending.';
  END IF;

  IF v_request.version <> p_expected_version THEN
    RAISE EXCEPTION 'Access request version conflict.';
  END IF;

  UPDATE qos.staff_access_requests sar
  SET
    status = 'rejected',
    version = sar.version + 1,
    decided_by_subject = trim(p_admin_subject),
    decision_note = nullif(trim(p_decision_note), ''),
    decided_at = now(),
    updated_at = now()
  WHERE sar.id = p_request_id
    AND sar.tenant_id = p_tenant_id
    AND sar.status = 'pending'
    AND sar.version = p_expected_version
  RETURNING sar.id, sar.status, sar.version, sar.decided_at
  INTO id, status, version, decided_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access request version conflict.';
  END IF;

  RETURN NEXT;
END;
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION qos.reject_staff_access_request(uuid, uuid, text, integer, text) TO qos_app;--> statement-breakpoint
CREATE OR REPLACE FUNCTION qos.approve_staff_access_request(
  p_tenant_id uuid,
  p_request_id uuid,
  p_admin_subject text,
  p_expected_version integer,
  p_role qos.staff_role,
  p_location_ids uuid[]
)
RETURNS TABLE (
  id uuid,
  status qos.access_request_status,
  version integer,
  membership_id uuid,
  decided_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = qos
AS $$
DECLARE
  v_request qos.staff_access_requests%ROWTYPE;
  v_identity_id uuid;
  v_membership_id uuid;
  v_location_id uuid;
  v_distinct_count integer;
BEGIN
  IF p_role NOT IN ('administrator', 'user') THEN
    RAISE EXCEPTION 'Invalid staff role.';
  END IF;

  IF p_location_ids IS NULL OR array_length(p_location_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one location is required.';
  END IF;

  SELECT count(DISTINCT loc_id)
  INTO v_distinct_count
  FROM unnest(p_location_ids) AS loc_id;

  IF v_distinct_count <> array_length(p_location_ids, 1) THEN
    RAISE EXCEPTION 'Duplicate location identifiers are not allowed.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_location_ids) AS loc_id
    LEFT JOIN qos.locations l ON l.id = loc_id AND l.tenant_id = p_tenant_id
    WHERE l.id IS NULL
  ) THEN
    RAISE EXCEPTION 'One or more locations are outside this business.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM qos.staff_identities si
    INNER JOIN qos.staff_memberships sm ON sm.staff_identity_id = si.id
    WHERE si.provider_subject = trim(p_admin_subject)
      AND sm.tenant_id = p_tenant_id
      AND sm.role = 'administrator'
      AND sm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Administrator membership required.';
  END IF;

  SELECT *
  INTO v_request
  FROM qos.staff_access_requests sar
  WHERE sar.id = p_request_id
    AND sar.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access request not found.';
  END IF;

  IF v_request.requester_subject = trim(p_admin_subject) THEN
    RAISE EXCEPTION 'Administrators cannot decide their own access request.';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Access request is no longer pending.';
  END IF;

  IF v_request.version <> p_expected_version THEN
    RAISE EXCEPTION 'Access request version conflict.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM qos.staff_identities si
    INNER JOIN qos.staff_memberships sm ON sm.staff_identity_id = si.id
    WHERE si.provider_subject = v_request.requester_subject
      AND sm.tenant_id = p_tenant_id
      AND sm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Staff membership already exists for this requester.';
  END IF;

  INSERT INTO qos.staff_identities (provider_subject, email)
  VALUES (v_request.requester_subject, v_request.requester_email)
  ON CONFLICT (provider_subject) DO UPDATE
    SET email = EXCLUDED.email
  RETURNING staff_identities.id INTO v_identity_id;

  IF v_identity_id IS NULL THEN
    SELECT si.id
    INTO v_identity_id
    FROM qos.staff_identities si
    WHERE si.provider_subject = v_request.requester_subject;
  END IF;

  INSERT INTO qos.staff_memberships (
    tenant_id,
    staff_identity_id,
    role,
    status
  )
  VALUES (
    p_tenant_id,
    v_identity_id,
    p_role,
    'active'
  )
  RETURNING staff_memberships.id INTO v_membership_id;

  FOREACH v_location_id IN ARRAY p_location_ids LOOP
    INSERT INTO qos.staff_access_request_locations (
      tenant_id,
      access_request_id,
      location_id
    )
    VALUES (
      p_tenant_id,
      p_request_id,
      v_location_id
    );

    INSERT INTO qos.staff_location_scopes (
      tenant_id,
      staff_membership_id,
      location_id
    )
    VALUES (
      p_tenant_id,
      v_membership_id,
      v_location_id
    );
  END LOOP;

  UPDATE qos.staff_access_requests sar
  SET
    status = 'approved',
    version = sar.version + 1,
    decided_by_subject = trim(p_admin_subject),
    decided_role = p_role,
    decided_at = now(),
    updated_at = now()
  WHERE sar.id = p_request_id
    AND sar.tenant_id = p_tenant_id
    AND sar.status = 'pending'
    AND sar.version = p_expected_version
  RETURNING sar.id, sar.status, sar.version, sar.decided_at
  INTO id, status, version, decided_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access request version conflict.';
  END IF;

  membership_id := v_membership_id;
  RETURN NEXT;
END;
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION qos.approve_staff_access_request(uuid, uuid, text, integer, qos.staff_role, uuid[]) TO qos_app;