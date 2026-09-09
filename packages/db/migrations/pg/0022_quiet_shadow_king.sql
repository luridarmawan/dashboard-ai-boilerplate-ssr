ALTER TABLE "ai_calls" ADD COLUMN "upstream_endpoint" varchar(16);--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "reasoning_tokens" integer;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "capabilities" jsonb;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "capabilities_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "preferred_endpoint" varchar(16);--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "last_probe_error" text;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "last_probe_ms" integer;