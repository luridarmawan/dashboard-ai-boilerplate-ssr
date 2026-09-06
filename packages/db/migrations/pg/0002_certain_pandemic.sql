CREATE TABLE "scheduler_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"locked_by" varchar(128),
	"locked_until" timestamp (3) with time zone,
	"run_started_at" timestamp (3) with time zone,
	"last_run_at" timestamp (3) with time zone,
	"last_status" varchar(8),
	"last_error" text,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduler_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job" varchar(128) NOT NULL,
	"instance_id" varchar(128) NOT NULL,
	"started_at" timestamp (3) with time zone NOT NULL,
	"finished_at" timestamp (3) with time zone,
	"duration_ms" integer,
	"status" varchar(8) NOT NULL,
	"error" text,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "scheduler_jobs_name_uq" ON "scheduler_jobs" USING btree ("name");--> statement-breakpoint
CREATE INDEX "scheduler_runs_job_started_at_idx" ON "scheduler_runs" USING btree ("job","started_at");