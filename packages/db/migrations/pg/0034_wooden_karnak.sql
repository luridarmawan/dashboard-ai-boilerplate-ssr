ALTER TABLE "clients" ADD COLUMN "reference_id" varchar(191);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "join_date" timestamp (3) with time zone;