CREATE TYPE "public"."event_category" AS ENUM('festival', 'concert', 'club', 'culture');--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "category" "event_category" DEFAULT 'festival' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "hero_image_credit" text;--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN "image_credit" text;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_hero_image_https" CHECK ("events"."hero_image_url" IS NULL OR "events"."hero_image_url" LIKE 'https://%');