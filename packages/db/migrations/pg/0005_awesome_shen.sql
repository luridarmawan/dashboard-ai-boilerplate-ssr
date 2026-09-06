CREATE TABLE "outbox_email" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid,
	"to_address" varchar(191) NOT NULL,
	"to_name" varchar(191),
	"subject" varchar(255) NOT NULL,
	"template" varchar(64) NOT NULL,
	"locale" varchar(8) DEFAULT 'id' NOT NULL,
	"payload" jsonb,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp (3) with time zone,
	"sent_at" timestamp (3) with time zone,
	"last_error" text,
	"transport" varchar(16),
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbox_email" ADD CONSTRAINT "outbox_email_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_email_status_next_attempt_at_idx" ON "outbox_email" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "outbox_email_to_address_idx" ON "outbox_email" USING btree ("to_address");--> statement-breakpoint
CREATE INDEX "outbox_email_created_at_idx" ON "outbox_email" USING btree ("created_at");