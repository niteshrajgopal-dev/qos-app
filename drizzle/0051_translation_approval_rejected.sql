-- MANUAL (Nitesh): add rejected to translation_approval_status for admin queue rejections
ALTER TYPE "qos"."translation_approval_status" ADD VALUE IF NOT EXISTS 'rejected';--> statement-breakpoint
