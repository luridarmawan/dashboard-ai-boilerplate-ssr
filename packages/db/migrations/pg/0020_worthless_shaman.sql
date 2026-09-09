CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"email" varchar(191) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"accepted_at" timestamp (3) with time zone,
	"accepted_user_id" uuid,
	"revoked_at" timestamp (3) with time zone,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_uq" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_client_id_email_idx" ON "invitations" USING btree ("client_id","email");--> statement-breakpoint
CREATE INDEX "invitations_expires_at_idx" ON "invitations" USING btree ("expires_at");