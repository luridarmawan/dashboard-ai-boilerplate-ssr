CREATE TABLE "cache_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "configurations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" varchar(36) NOT NULL,
	"client_id" uuid,
	"section" varchar(64) NOT NULL,
	"sub" varchar(64),
	"key" varchar(191) NOT NULL,
	"value" text,
	"type" varchar(16) NOT NULL,
	"title" varchar(191),
	"note" text,
	"order" integer DEFAULT 100 NOT NULL,
	"public" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" varchar(36) NOT NULL,
	"client_id" uuid,
	"module" varchar(64) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "configurations" ADD CONSTRAINT "configurations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cache_versions_name_uq" ON "cache_versions" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "configurations_scope_key_uq" ON "configurations" USING btree ("scope","key");--> statement-breakpoint
CREATE INDEX "configurations_section_idx" ON "configurations" USING btree ("section");--> statement-breakpoint
CREATE UNIQUE INDEX "modules_scope_module_uq" ON "modules" USING btree ("scope","module");