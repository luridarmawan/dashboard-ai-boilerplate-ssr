CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" varchar(64) NOT NULL,
	"resource" varchar(64) NOT NULL,
	"resource_id" varchar(64),
	"ip" varchar(45),
	"request_id" varchar(64),
	"before" jsonb,
	"after" jsonb,
	"note" text,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"parent_id" uuid,
	"code" varchar(32) NOT NULL,
	"name" varchar(191) NOT NULL,
	"settings" jsonb,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE INDEX "audit_log_client_id_created_at_idx" ON "audit_log" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_client_id_resource_resource_id_idx" ON "audit_log" USING btree ("client_id","resource","resource_id");--> statement-breakpoint
CREATE INDEX "audit_log_client_id_actor_id_idx" ON "audit_log" USING btree ("client_id","actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_code_uq" ON "clients" USING btree ("code");--> statement-breakpoint
CREATE INDEX "clients_parent_id_idx" ON "clients" USING btree ("parent_id");