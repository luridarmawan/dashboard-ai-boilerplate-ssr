CREATE TABLE "ai_credit_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"amount_micro" bigint NOT NULL,
	"balance_after_micro" bigint,
	"note" varchar(255),
	"actor_id" uuid,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_credits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"balance_micro" bigint,
	"spent_micro" bigint DEFAULT 0 NOT NULL,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_credit_ledger_client_id_created_at_idx" ON "ai_credit_ledger" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credits_client_id_uq" ON "ai_credits" USING btree ("client_id");