CREATE TABLE "ai_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"mime" varchar(128) NOT NULL,
	"size" integer NOT NULL,
	"status_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_attachments" ADD CONSTRAINT "ai_attachments_message_id_ai_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."ai_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_attachments" ADD CONSTRAINT "ai_attachments_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_attachments" ADD CONSTRAINT "ai_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_attachments_client_id_conversation_id_idx" ON "ai_attachments" USING btree ("client_id","conversation_id");--> statement-breakpoint
CREATE INDEX "ai_attachments_client_id_message_id_idx" ON "ai_attachments" USING btree ("client_id","message_id");--> statement-breakpoint
CREATE INDEX "ai_messages_client_id_parent_id_idx" ON "ai_messages" USING btree ("client_id","parent_id");