CREATE TABLE "ai_mcp_tools" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"mcp_id" uuid NOT NULL,
	"name" varchar(191) NOT NULL,
	"wire" varchar(64) NOT NULL,
	"description" text,
	"input_schema" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_mcps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(191) NOT NULL,
	"transport" varchar(16) DEFAULT 'http' NOT NULL,
	"url" varchar(512) NOT NULL,
	"headers" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_status" varchar(16),
	"last_error" text,
	"last_synced_at" timestamp (3) with time zone,
	"tools_count" integer DEFAULT 0 NOT NULL,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_mcp_tools" ADD CONSTRAINT "ai_mcp_tools_mcp_id_ai_mcps_id_fk" FOREIGN KEY ("mcp_id") REFERENCES "public"."ai_mcps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_mcp_tools_client_id_mcp_id_wire_uq" ON "ai_mcp_tools" USING btree ("client_id","mcp_id","wire");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_mcps_client_id_code_uq" ON "ai_mcps" USING btree ("client_id","code");