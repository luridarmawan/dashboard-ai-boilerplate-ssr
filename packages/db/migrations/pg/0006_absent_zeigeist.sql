CREATE TABLE "example_inquiries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"name" varchar(191) NOT NULL,
	"email" varchar(191) NOT NULL,
	"message" text NOT NULL,
	"source" varchar(191),
	"ip" varchar(45),
	"state" varchar(16) DEFAULT 'new' NOT NULL,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "example_products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"slug" varchar(120) NOT NULL,
	"name" varchar(191) NOT NULL,
	"summary" varchar(512),
	"description" text,
	"price" integer DEFAULT 0 NOT NULL,
	"currency" varchar(3) DEFAULT 'IDR' NOT NULL,
	"image_url" varchar(512),
	"featured" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 100 NOT NULL,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "example_testimonials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"author" varchar(191) NOT NULL,
	"role" varchar(191),
	"quote" text NOT NULL,
	"avatar_url" varchar(512),
	"sort" integer DEFAULT 100 NOT NULL,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE INDEX "example_inquiries_client_id_created_at_idx" ON "example_inquiries" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "example_inquiries_client_id_state_idx" ON "example_inquiries" USING btree ("client_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "example_products_client_id_slug_uq" ON "example_products" USING btree ("client_id","slug");--> statement-breakpoint
CREATE INDEX "example_products_client_id_featured_sort_idx" ON "example_products" USING btree ("client_id","featured","sort");--> statement-breakpoint
CREATE INDEX "example_testimonials_client_id_sort_idx" ON "example_testimonials" USING btree ("client_id","sort");