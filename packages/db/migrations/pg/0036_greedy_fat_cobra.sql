ALTER TABLE "pages_pages" ADD COLUMN "image_id" uuid;--> statement-breakpoint
ALTER TABLE "pages_pages" ADD COLUMN "image_alt" varchar(191);--> statement-breakpoint
CREATE INDEX "pages_pages_client_id_image_id_idx" ON "pages_pages" USING btree ("client_id","image_id");