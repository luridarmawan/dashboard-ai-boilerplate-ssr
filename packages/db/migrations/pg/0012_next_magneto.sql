CREATE TABLE "ai_models" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"model" varchar(120) NOT NULL,
	"label" varchar(191),
	"price_in_micro" bigint DEFAULT 0 NOT NULL,
	"price_out_micro" bigint DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(191) NOT NULL,
	"base_url" varchar(512) NOT NULL,
	"api_key" text,
	"default_model" varchar(120) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"last_status" varchar(16),
	"last_error" text,
	"last_tested_at" timestamp (3) with time zone,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "provider" varchar(40);--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "provider_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_models_client_id_provider_id_model_uq" ON "ai_models" USING btree ("client_id","provider_id","model");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_providers_client_id_code_uq" ON "ai_providers" USING btree ("client_id","code");--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE set null ON UPDATE no action;