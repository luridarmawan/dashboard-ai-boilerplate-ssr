CREATE TABLE "pages_pages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"title" varchar(191) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"summary" varchar(512),
	"body" text,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"published_at" timestamp (3) with time zone,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "pages_redirects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"old_slug" varchar(120) NOT NULL,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pages_pages_client_id_slug_uq" ON "pages_pages" USING btree ("client_id","slug");--> statement-breakpoint
CREATE INDEX "pages_pages_client_id_status_idx" ON "pages_pages" USING btree ("client_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_redirects_client_id_old_slug_uq" ON "pages_redirects" USING btree ("client_id","old_slug");--> statement-breakpoint
CREATE INDEX "pages_redirects_client_id_page_id_idx" ON "pages_redirects" USING btree ("client_id","page_id");