CREATE TABLE "ai_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid,
	"conversation_id" uuid,
	"endpoint" varchar(64) NOT NULL,
	"model" varchar(120),
	"tokens_in" integer,
	"tokens_out" integer,
	"tokens_total" integer,
	"latency_ms" integer,
	"first_token_ms" integer,
	"status" varchar(16) NOT NULL,
	"error" text,
	"cost_micro" integer,
	"streamed" boolean DEFAULT false NOT NULL,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(191) NOT NULL,
	"model" varchar(120),
	"archived_at" timestamp (3) with time zone,
	"last_message_at" timestamp (3) with time zone,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" varchar(16) NOT NULL,
	"content" text NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_calls_client_id_created_at_idx" ON "ai_calls" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_calls_client_id_user_id_idx" ON "ai_calls" USING btree ("client_id","user_id");--> statement-breakpoint
CREATE INDEX "ai_conversations_client_id_user_id_last_message_at_idx" ON "ai_conversations" USING btree ("client_id","user_id","last_message_at");--> statement-breakpoint
CREATE INDEX "ai_messages_client_id_conversation_id_created_at_idx" ON "ai_messages" USING btree ("client_id","conversation_id","created_at");