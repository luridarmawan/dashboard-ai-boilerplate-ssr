CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(64) NOT NULL,
	"title" varchar(191) NOT NULL,
	"body" text,
	"link" varchar(512),
	"data" jsonb,
	"read_at" timestamp (3) with time zone,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_client_id_user_id_read_at_created_at_idx" ON "notifications" USING btree ("client_id","user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "notifications_client_id_created_at_idx" ON "notifications" USING btree ("client_id","created_at");