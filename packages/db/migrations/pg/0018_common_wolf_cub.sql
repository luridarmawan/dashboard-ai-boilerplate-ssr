CREATE TABLE "queue_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"payload" jsonb,
	"client_id" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_at" timestamp (3) with time zone NOT NULL,
	"locked_by" varchar(128),
	"locked_until" timestamp (3) with time zone,
	"last_error" text,
	"dedupe_key" varchar(191),
	"request_id" varchar(64),
	"started_at" timestamp (3) with time zone,
	"finished_at" timestamp (3) with time zone,
	"result" jsonb,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "queue_jobs" ADD CONSTRAINT "queue_jobs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "queue_jobs_status_run_at_priority_idx" ON "queue_jobs" USING btree ("status","run_at","priority");--> statement-breakpoint
CREATE INDEX "queue_jobs_name_status_idx" ON "queue_jobs" USING btree ("name","status");--> statement-breakpoint
CREATE INDEX "queue_jobs_client_id_created_at_idx" ON "queue_jobs" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "queue_jobs_dedupe_key_idx" ON "queue_jobs" USING btree ("dedupe_key");