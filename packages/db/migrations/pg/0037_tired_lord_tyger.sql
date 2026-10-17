CREATE TABLE "permalinks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"path" varchar(255) NOT NULL,
	"module" varchar(64) NOT NULL,
	"target" varchar(64) NOT NULL,
	"kind" varchar(16) DEFAULT 'canonical' NOT NULL,
	"live" boolean DEFAULT false NOT NULL,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "permalinks_client_id_path_uq" ON "permalinks" USING btree ("client_id","path");--> statement-breakpoint
CREATE INDEX "permalinks_client_id_module_target_idx" ON "permalinks" USING btree ("client_id","module","target");