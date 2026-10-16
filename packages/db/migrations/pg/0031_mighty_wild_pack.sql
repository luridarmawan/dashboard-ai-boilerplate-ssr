ALTER TABLE "clients" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "balance" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "total_receipts" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "rt" varchar(8);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "rw" varchar(8);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "kelurahan" varchar(191);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "kelurahan_id" varchar(32);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "kecamatan" varchar(191);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "kecamatan_id" varchar(32);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "city" varchar(191);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "city_id" varchar(32);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "regency" varchar(191);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "province" varchar(191);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "province_id" varchar(32);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "region" varchar(191);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "region_id" varchar(32);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "country_id" varchar(32);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "latitude" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "longitude" numeric(11, 7);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "maps_url" varchar(2048);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "url" varchar(2048);