CREATE TYPE "qos"."catalogue_stop_sale_target_type" AS ENUM('product', 'variant', 'modifier_option');--> statement-breakpoint
CREATE TABLE "qos"."location_item_stop_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"target_type" "qos"."catalogue_stop_sale_target_type" NOT NULL,
	"target_public_id" text NOT NULL,
	"reason" text NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by_subject" text NOT NULL,
	"cleared_at" timestamp with time zone,
	"cleared_by_subject" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qos"."location_schedule_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"exception_date" text NOT NULL,
	"closed_all_day" boolean DEFAULT true NOT NULL,
	"start_minute" integer,
	"end_minute" integer,
	"priority" integer DEFAULT 0 NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_schedule_exceptions_unique" UNIQUE("tenant_id","location_id","exception_date","priority")
);
--> statement-breakpoint
CREATE TABLE "qos"."location_weekly_schedule_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qos"."location_item_stop_sales" ADD CONSTRAINT "location_item_stop_sales_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "qos"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."location_schedule_exceptions" ADD CONSTRAINT "location_schedule_exceptions_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "qos"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qos"."location_weekly_schedule_windows" ADD CONSTRAINT "location_weekly_schedule_windows_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "qos"."locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "location_item_stop_sales_tenant_id_idx" ON "qos"."location_item_stop_sales" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "location_item_stop_sales_lookup_idx" ON "qos"."location_item_stop_sales" USING btree ("tenant_id","location_id","target_type","target_public_id");--> statement-breakpoint
CREATE INDEX "location_schedule_exceptions_tenant_id_idx" ON "qos"."location_schedule_exceptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "location_weekly_schedule_windows_tenant_id_idx" ON "qos"."location_weekly_schedule_windows" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "location_weekly_schedule_windows_location_idx" ON "qos"."location_weekly_schedule_windows" USING btree ("tenant_id","location_id");--> statement-breakpoint
GRANT ALL ON TABLE qos.location_item_stop_sales TO qos_app;--> statement-breakpoint
GRANT ALL ON TABLE qos.location_schedule_exceptions TO qos_app;--> statement-breakpoint
GRANT ALL ON TABLE qos.location_weekly_schedule_windows TO qos_app;--> statement-breakpoint
ALTER TABLE qos.location_item_stop_sales ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.location_item_stop_sales FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY location_item_stop_sales_tenant_isolation ON qos.location_item_stop_sales
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.location_schedule_exceptions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.location_schedule_exceptions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY location_schedule_exceptions_tenant_isolation ON qos.location_schedule_exceptions
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE qos.location_weekly_schedule_windows ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE qos.location_weekly_schedule_windows FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY location_weekly_schedule_windows_tenant_isolation ON qos.location_weekly_schedule_windows
  FOR ALL
  USING (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('qos.current_tenant_id', true), '')::uuid);