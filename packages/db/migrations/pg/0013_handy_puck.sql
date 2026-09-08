CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp (3) with time zone,
	"response_status" integer,
	"last_error" text,
	"delivered_at" timestamp (3) with time zone,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"name" varchar(191) NOT NULL,
	"url" varchar(512) NOT NULL,
	"secret" text NOT NULL,
	"events" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_status" varchar(16),
	"last_error" text,
	"last_delivered_at" timestamp (3) with time zone,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_client_id_webhook_id_created_at_idx" ON "webhook_deliveries" USING btree ("client_id","webhook_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_client_id_status_next_attempt_at_idx" ON "webhook_deliveries" USING btree ("client_id","status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhooks_client_id_enabled_idx" ON "webhooks" USING btree ("client_id","enabled");