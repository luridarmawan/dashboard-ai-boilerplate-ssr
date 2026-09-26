CREATE TABLE "example_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"slug" varchar(120) NOT NULL,
	"name" varchar(191) NOT NULL,
	"description" varchar(512),
	"sort" integer DEFAULT 100 NOT NULL,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone
);
--> statement-breakpoint
ALTER TABLE "example_products" ADD COLUMN "category_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "example_categories_client_id_slug_uq" ON "example_categories" USING btree ("client_id","slug");--> statement-breakpoint
CREATE INDEX "example_categories_client_id_sort_idx" ON "example_categories" USING btree ("client_id","sort");--> statement-breakpoint
CREATE INDEX "example_products_client_id_category_id_idx" ON "example_products" USING btree ("client_id","category_id");