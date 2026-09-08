CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid,
	"key" varchar(255) NOT NULL,
	"storage" varchar(16) NOT NULL,
	"name" varchar(255) NOT NULL,
	"mime" varchar(128) NOT NULL,
	"size" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"kind" varchar(64) DEFAULT 'generic' NOT NULL,
	"visibility" varchar(16) DEFAULT 'private' NOT NULL,
	"meta" jsonb,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone
);
--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "assets" jsonb;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_client_id_user_id_created_at_idx" ON "files" USING btree ("client_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "files_client_id_kind_idx" ON "files" USING btree ("client_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "files_client_id_key_uq" ON "files" USING btree ("client_id","key");