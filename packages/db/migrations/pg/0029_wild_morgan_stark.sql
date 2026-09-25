ALTER TABLE "outbox_email" ADD COLUMN "open_token" varchar(64);--> statement-breakpoint
ALTER TABLE "outbox_email" ADD COLUMN "opened_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "outbox_email" ADD COLUMN "open_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_email" ADD COLUMN "clicked_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "outbox_email" ADD COLUMN "acted_at" timestamp (3) with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_email_open_token_uq" ON "outbox_email" USING btree ("open_token");