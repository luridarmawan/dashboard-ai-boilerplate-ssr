ALTER TABLE "outbox_email" ALTER COLUMN "locale" SET DEFAULT 'en';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "locale" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "locale" DROP NOT NULL;