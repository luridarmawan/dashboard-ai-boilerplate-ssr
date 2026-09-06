CREATE TABLE "dummy_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"title" varchar(191) NOT NULL,
	"body" text,
	"state" varchar(16) DEFAULT 'draft' NOT NULL,
	"tags" jsonb,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE INDEX "dummy_notes_client_id_state_idx" ON "dummy_notes" USING btree ("client_id","state");