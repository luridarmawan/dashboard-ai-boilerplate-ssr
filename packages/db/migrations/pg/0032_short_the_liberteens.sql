CREATE TABLE "regions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(16) NOT NULL,
	"parent_code" varchar(16),
	"country_code" varchar(3) DEFAULT 'ID' NOT NULL,
	"level" integer NOT NULL,
	"name" varchar(191) NOT NULL,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "regions_code_uq" ON "regions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "regions_parent_code_idx" ON "regions" USING btree ("parent_code");--> statement-breakpoint
CREATE INDEX "regions_country_code_level_idx" ON "regions" USING btree ("country_code","level");