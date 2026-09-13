ALTER TABLE "qos"."catalogue_modifier_groups" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_modifier_groups" ADD COLUMN "status" "qos"."product_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_modifier_options" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_modifier_options" ADD COLUMN "allows_quantity" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_modifier_options" ADD COLUMN "max_quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "qos"."catalogue_modifier_options" ADD COLUMN "status" "qos"."product_status" DEFAULT 'active' NOT NULL;