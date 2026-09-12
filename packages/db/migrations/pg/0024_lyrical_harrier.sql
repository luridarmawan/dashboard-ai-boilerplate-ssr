ALTER TABLE "ai_models" ADD COLUMN "capabilities" jsonb;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "capabilities_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "preferred_endpoint" varchar(16);--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "last_status" varchar(16);--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "last_tested_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "last_probe_ms" integer;