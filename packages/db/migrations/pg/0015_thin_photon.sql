CREATE TABLE "mfa_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"ip" varchar(45),
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_mfa" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"secret" text NOT NULL,
	"enabled_at" timestamp (3) with time zone,
	"recovery_codes" jsonb,
	"last_step" integer,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_mfa" ADD CONSTRAINT "user_mfa_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_challenges_token_hash_uq" ON "mfa_challenges" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "mfa_challenges_expires_at_idx" ON "mfa_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_mfa_user_id_uq" ON "user_mfa" USING btree ("user_id");