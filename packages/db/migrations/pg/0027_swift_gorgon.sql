ALTER TABLE "users" ADD COLUMN "last_active_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_active_ip" varchar(45);