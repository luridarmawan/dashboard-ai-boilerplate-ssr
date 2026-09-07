CREATE TABLE "themes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" varchar(36) NOT NULL,
	"client_id" uuid,
	"code" varchar(64) NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	"base" varchar(64) NOT NULL,
	"tokens" jsonb NOT NULL,
	"icons" varchar(64) NOT NULL,
	"layouts" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone
);
--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "themes_scope_code_uq" ON "themes" USING btree ("scope","code");