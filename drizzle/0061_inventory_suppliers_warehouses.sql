-- MANUAL (Nitesh): QOS-196 inventory suppliers, branch warehouses and the item
-- default supplier. Apply with the admin connection after 0060 (it extends
-- 0060's inventory_items) and before deploying the matching web/API image.
-- Journal `when` is 1793400000000 (after 0060's 1793300000000).
-- Additive only: two new tenant tables and one nullable column on
-- inventory_items. No seeded rows and no change to qos.locations: a warehouse
-- references a location through a composite FK and never copies or renames it.
-- At most one active warehouse per location (partial unique index); archived
-- warehouses keep their location as history. No table grants DELETE (archive only).

CREATE TABLE IF NOT EXISTS "qos"."inventory_suppliers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "public_id" text NOT NULL,
  "name_en" text NOT NULL,
  "name_ar" text,
  "code" text,
  "contact_name" text,
  "phone" text,
  "email" text,
  "address" text,
  "notes" text,
  "status" text DEFAULT 'active' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "provenance" "qos"."data_provenance" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_subject" text,
  "updated_by_subject" text,
  CONSTRAINT "inventory_suppliers_public_id_check" CHECK ("public_id" ~ '^sup_[a-z0-9_-]+$'),
  CONSTRAINT "inventory_suppliers_name_en_check" CHECK (char_length(btrim("name_en")) BETWEEN 1 AND 120),
  CONSTRAINT "inventory_suppliers_name_ar_check" CHECK ("name_ar" IS NULL OR char_length(btrim("name_ar")) BETWEEN 1 AND 120),
  CONSTRAINT "inventory_suppliers_code_check" CHECK ("code" IS NULL OR "code" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$'),
  CONSTRAINT "inventory_suppliers_contact_name_check" CHECK ("contact_name" IS NULL OR char_length("contact_name") <= 120),
  CONSTRAINT "inventory_suppliers_phone_check" CHECK ("phone" IS NULL OR char_length("phone") <= 40),
  CONSTRAINT "inventory_suppliers_email_check" CHECK ("email" IS NULL OR char_length("email") <= 254),
  CONSTRAINT "inventory_suppliers_address_check" CHECK ("address" IS NULL OR char_length("address") <= 400),
  CONSTRAINT "inventory_suppliers_notes_check" CHECK ("notes" IS NULL OR char_length("notes") <= 1000),
  CONSTRAINT "inventory_suppliers_status_check" CHECK ("status" IN ('active', 'archived')),
  CONSTRAINT "inventory_suppliers_version_check" CHECK ("version" >= 1),
  CONSTRAINT "inventory_suppliers_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "inventory_suppliers_tenant_public_id_unique" UNIQUE ("tenant_id", "public_id"),
  CONSTRAINT "inventory_suppliers_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "qos"."tenants"("id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_suppliers_tenant_code_unique" ON "qos"."inventory_suppliers" USING btree ("tenant_id", lower("code")) WHERE "code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_suppliers_tenant_id_idx" ON "qos"."inventory_suppliers" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "qos"."inventory_suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."inventory_suppliers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."inventory_suppliers" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "qos"."inventory_suppliers" TO qos_app;--> statement-breakpoint
CREATE POLICY "inventory_suppliers_tenant_isolation" ON "qos"."inventory_suppliers"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qos"."inventory_warehouses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "public_id" text NOT NULL,
  "location_id" uuid NOT NULL,
  "code" text NOT NULL,
  "name_en" text NOT NULL,
  "name_ar" text,
  "notes" text,
  "status" text DEFAULT 'active' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "provenance" "qos"."data_provenance" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_subject" text,
  "updated_by_subject" text,
  CONSTRAINT "inventory_warehouses_public_id_check" CHECK ("public_id" ~ '^wh_[a-z0-9_-]+$'),
  CONSTRAINT "inventory_warehouses_code_check" CHECK ("code" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$'),
  CONSTRAINT "inventory_warehouses_name_en_check" CHECK (char_length(btrim("name_en")) BETWEEN 1 AND 120),
  CONSTRAINT "inventory_warehouses_name_ar_check" CHECK ("name_ar" IS NULL OR char_length(btrim("name_ar")) BETWEEN 1 AND 120),
  CONSTRAINT "inventory_warehouses_notes_check" CHECK ("notes" IS NULL OR char_length("notes") <= 400),
  CONSTRAINT "inventory_warehouses_status_check" CHECK ("status" IN ('active', 'archived')),
  CONSTRAINT "inventory_warehouses_version_check" CHECK ("version" >= 1),
  CONSTRAINT "inventory_warehouses_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "inventory_warehouses_tenant_public_id_unique" UNIQUE ("tenant_id", "public_id"),
  CONSTRAINT "inventory_warehouses_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "qos"."tenants"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "inventory_warehouses_location_fk" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "qos"."locations"("tenant_id", "id") ON DELETE restrict ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_warehouses_tenant_code_unique" ON "qos"."inventory_warehouses" USING btree ("tenant_id", lower("code"));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_warehouses_active_location_unique" ON "qos"."inventory_warehouses" USING btree ("tenant_id", "location_id") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_warehouses_tenant_location_idx" ON "qos"."inventory_warehouses" USING btree ("tenant_id", "location_id");--> statement-breakpoint
ALTER TABLE "qos"."inventory_warehouses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "qos"."inventory_warehouses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "qos"."inventory_warehouses" FROM qos_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "qos"."inventory_warehouses" TO qos_app;--> statement-breakpoint
CREATE POLICY "inventory_warehouses_tenant_isolation" ON "qos"."inventory_warehouses"
  AS PERMISSIVE FOR ALL
  TO qos_app
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "qos"."inventory_items" ADD COLUMN IF NOT EXISTS "default_supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "qos"."inventory_items" ADD CONSTRAINT "inventory_items_default_supplier_fk" FOREIGN KEY ("tenant_id", "default_supplier_id") REFERENCES "qos"."inventory_suppliers"("tenant_id", "id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_items_tenant_default_supplier_idx" ON "qos"."inventory_items" USING btree ("tenant_id", "default_supplier_id");

-- Down script (documentation only; not executed). Roll the application back first,
-- then run with the admin connection and delete the idx 61 row from
-- drizzle.__drizzle_migrations if it was recorded:
--   DROP INDEX IF EXISTS "qos"."inventory_items_tenant_default_supplier_idx";
--   ALTER TABLE "qos"."inventory_items" DROP CONSTRAINT IF EXISTS "inventory_items_default_supplier_fk";
--   ALTER TABLE "qos"."inventory_items" DROP COLUMN IF EXISTS "default_supplier_id";
--   DROP TABLE IF EXISTS "qos"."inventory_warehouses";
--   DROP TABLE IF EXISTS "qos"."inventory_suppliers";
