ALTER TABLE "clients" ADD COLUMN "short_code" varchar(3);--> statement-breakpoint
CREATE UNIQUE INDEX "clients_short_code_uq" ON "clients" USING btree ("short_code");