CREATE TYPE "public"."payment_disposition" AS ENUM('none', 'accepted', 'refund_required', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'dead');--> statement-breakpoint
CREATE TYPE "public"."simulator_payment_status" AS ENUM('pending', 'succeeded', 'failed', 'refunded');--> statement-breakpoint
CREATE TABLE "api_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"dedupe_key" text,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "jobs_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "jobs_attempts_bounds" CHECK ("jobs"."attempts" >= 0 AND "jobs"."max_attempts" BETWEEN 1 AND 20),
	CONSTRAINT "jobs_lease_when_running" CHECK ("jobs"."status" <> 'running' OR ("jobs"."locked_by" IS NOT NULL AND "jobs"."locked_until" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "simulator_payments" (
	"provider_reference" text PRIMARY KEY NOT NULL,
	"merchant_reference" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "simulator_payment_status" NOT NULL,
	"scenario" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "simulator_payments_merchant_reference_unique" UNIQUE("merchant_reference")
);
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_reservation_id_reservations_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_payment_attempt_id_payment_attempts_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "reservation_items" DROP CONSTRAINT "reservation_items_reservation_id_reservations_id_fk";
--> statement-breakpoint
ALTER TABLE "reservation_items" DROP CONSTRAINT "reservation_items_inventory_item_id_inventory_items_id_fk";
--> statement-breakpoint
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_inventory_item_id_inventory_items_id_fk";
--> statement-breakpoint
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_user_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "payment_attempts_one_success_per_reservation";--> statement-breakpoint
DROP INDEX "reservations_user_idx";--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "disposition" "payment_disposition" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_provider_events" ADD COLUMN "provider_reference" text NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_provider_events" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "reservation_items" ADD COLUMN "event_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "request_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "reservation_id" uuid NOT NULL;--> statement-breakpoint
CREATE INDEX "jobs_claimable_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_id_event_unique" UNIQUE("id","event_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_id_reservation_user_event_unique" UNIQUE("id","reservation_id","user_id","event_id");--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_id_reservation_unique" UNIQUE("id","reservation_id");--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_id_event_unique" UNIQUE("id","event_id");--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_id_user_event_unique" UNIQUE("id","user_id","event_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_reservation_user_event_fk" FOREIGN KEY ("reservation_id","user_id","event_id") REFERENCES "public"."reservations"("id","user_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_payment_reservation_fk" FOREIGN KEY ("payment_attempt_id","reservation_id") REFERENCES "public"."payment_attempts"("id","reservation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_reservation_event_fk" FOREIGN KEY ("reservation_id","event_id") REFERENCES "public"."reservations"("id","event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_inventory_event_fk" FOREIGN KEY ("inventory_item_id","event_id") REFERENCES "public"."inventory_items"("id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_order_fk" FOREIGN KEY ("order_id","reservation_id","user_id","event_id") REFERENCES "public"."orders"("id","reservation_id","user_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_reservation_item_fk" FOREIGN KEY ("reservation_id","inventory_item_id") REFERENCES "public"."reservation_items"("reservation_id","inventory_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_one_accepted_per_reservation" ON "payment_attempts" USING btree ("reservation_id") WHERE "payment_attempts"."disposition" = 'accepted';--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_one_in_flight_per_reservation" ON "payment_attempts" USING btree ("reservation_id") WHERE "payment_attempts"."status" IN ('initiated', 'pending');--> statement-breakpoint
CREATE INDEX "payment_attempts_status_idx" ON "payment_attempts" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "payment_provider_events_unprocessed_idx" ON "payment_provider_events" USING btree ("received_at") WHERE "payment_provider_events"."processed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "reservation_items_inventory_idx" ON "reservation_items" USING btree ("inventory_item_id");--> statement-breakpoint
CREATE INDEX "reservations_user_status_idx" ON "reservations" USING btree ("user_id","status");--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_disposition_requires_success" CHECK ("payment_attempts"."disposition" = 'none' OR "payment_attempts"."status" = 'succeeded');--> statement-breakpoint
ALTER TABLE "payment_provider_events" ADD CONSTRAINT "payment_provider_events_outcome_when_processed" CHECK (("payment_provider_events"."processed_at" IS NULL) = ("payment_provider_events"."outcome" IS NULL));--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_closed_at" CHECK (("reservations"."status" = 'active') = ("reservations"."closed_at" IS NULL));