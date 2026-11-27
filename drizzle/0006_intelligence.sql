CREATE TYPE "public"."action_initiator" AS ENUM('user', 'ai_agent', 'automation');--> statement-breakpoint
CREATE TYPE "public"."action_request_status" AS ENUM('pending_approval', 'approved', 'rejected', 'expired', 'executed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ai_call_status" AS ENUM('succeeded', 'failed', 'timeout', 'refused', 'invalid_output', 'budget_exceeded');--> statement-breakpoint
CREATE TYPE "public"."demand_signal_kind" AS ENUM('waitlist_request', 'sold_out_view', 'search_unmatched');--> statement-breakpoint
CREATE TYPE "public"."narrative_source" AS ENUM('rules', 'ai');--> statement-breakpoint
CREATE TYPE "public"."recommendation_status" AS ENUM('open', 'drafted', 'published', 'dismissed');--> statement-breakpoint
CREATE TABLE "action_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"initiator" "action_initiator" NOT NULL,
	"risk" text NOT NULL,
	"params" jsonb NOT NULL,
	"params_hash" text NOT NULL,
	"status" "action_request_status" DEFAULT 'pending_approval' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"executed_at" timestamp with time zone,
	"result" jsonb,
	"error_code" text,
	"recommendation_id" uuid,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_requests_hash_format" CHECK ("action_requests"."params_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "action_requests_risk" CHECK ("action_requests"."risk" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
	CONSTRAINT "action_requests_decision" CHECK (("action_requests"."status" IN ('pending_approval', 'expired')) OR ("action_requests"."decided_by_user_id" IS NOT NULL AND "action_requests"."decided_at" IS NOT NULL)),
	CONSTRAINT "action_requests_executed_at" CHECK (("action_requests"."status" = 'executed') = ("action_requests"."executed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ai_usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" "ai_call_status" NOT NULL,
	"organization_id" uuid,
	"user_id" uuid,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_records_non_negative" CHECK ("ai_usage_records"."input_tokens" >= 0 AND "ai_usage_records"."output_tokens" >= 0 AND "ai_usage_records"."cost_micro_usd" >= 0 AND "ai_usage_records"."latency_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commercial_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"source_inventory_item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" "recommendation_status" DEFAULT 'open' NOT NULL,
	"evidence" jsonb NOT NULL,
	"proposal" jsonb NOT NULL,
	"assumptions" jsonb NOT NULL,
	"risks" jsonb NOT NULL,
	"narrative" text NOT NULL,
	"narrative_source" "narrative_source" NOT NULL,
	"narrative_model" text,
	"experience_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_recommendations_source_kind_unique" UNIQUE("source_inventory_item_id","kind"),
	CONSTRAINT "commercial_recommendations_experience_unique" UNIQUE("experience_id"),
	CONSTRAINT "commercial_recommendations_experience_when_drafted" CHECK ("commercial_recommendations"."status" NOT IN ('drafted', 'published') OR "commercial_recommendations"."experience_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "demand_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "demand_signal_kind" NOT NULL,
	"organization_id" uuid,
	"event_id" uuid,
	"inventory_item_id" uuid,
	"subject_key" text NOT NULL,
	"user_id" uuid,
	"query" text,
	"origin" "data_origin" DEFAULT 'live' NOT NULL,
	"occurred_on" date DEFAULT (now() AT TIME ZONE 'utc')::date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demand_signals_shape" CHECK (CASE "demand_signals"."kind"
            WHEN 'search_unmatched' THEN "demand_signals"."query" IS NOT NULL AND "demand_signals"."inventory_item_id" IS NULL
            ELSE "demand_signals"."inventory_item_id" IS NOT NULL AND "demand_signals"."event_id" IS NOT NULL AND "demand_signals"."organization_id" IS NOT NULL
          END),
	CONSTRAINT "demand_signals_query_length" CHECK ("demand_signals"."query" IS NULL OR char_length("demand_signals"."query") BETWEEN 1 AND 120)
);
--> statement-breakpoint
ALTER TABLE "action_requests" ADD CONSTRAINT "action_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_requests" ADD CONSTRAINT "action_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_requests" ADD CONSTRAINT "action_requests_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_requests" ADD CONSTRAINT "action_requests_recommendation_id_commercial_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."commercial_recommendations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_recommendations" ADD CONSTRAINT "commercial_recommendations_event_tenant_fk" FOREIGN KEY ("event_id","organization_id") REFERENCES "public"."events"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_recommendations" ADD CONSTRAINT "commercial_recommendations_source_event_fk" FOREIGN KEY ("source_inventory_item_id","event_id") REFERENCES "public"."inventory_items"("id","event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_recommendations" ADD CONSTRAINT "commercial_recommendations_experience_event_fk" FOREIGN KEY ("experience_id","event_id") REFERENCES "public"."experiences"("id","event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_signals" ADD CONSTRAINT "demand_signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_signals" ADD CONSTRAINT "demand_signals_event_tenant_fk" FOREIGN KEY ("event_id","organization_id") REFERENCES "public"."events"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_signals" ADD CONSTRAINT "demand_signals_inventory_event_fk" FOREIGN KEY ("inventory_item_id","event_id") REFERENCES "public"."inventory_items"("id","event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_requests_open_unique" ON "action_requests" USING btree ("action_id","organization_id","params_hash") WHERE "action_requests"."status" IN ('pending_approval', 'approved');--> statement-breakpoint
CREATE INDEX "action_requests_org_status_idx" ON "action_requests" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_records_created_idx" ON "ai_usage_records" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "commercial_recommendations_org_idx" ON "commercial_recommendations" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_signals_waitlist_unique" ON "demand_signals" USING btree ("inventory_item_id","subject_key") WHERE "demand_signals"."kind" = 'waitlist_request';--> statement-breakpoint
CREATE UNIQUE INDEX "demand_signals_view_daily_unique" ON "demand_signals" USING btree ("inventory_item_id","subject_key","occurred_on") WHERE "demand_signals"."kind" = 'sold_out_view';--> statement-breakpoint
CREATE UNIQUE INDEX "demand_signals_search_daily_unique" ON "demand_signals" USING btree ("query","subject_key","occurred_on") WHERE "demand_signals"."kind" = 'search_unmatched';--> statement-breakpoint
CREATE INDEX "demand_signals_item_kind_idx" ON "demand_signals" USING btree ("inventory_item_id","kind");--> statement-breakpoint
CREATE INDEX "demand_signals_org_idx" ON "demand_signals" USING btree ("organization_id","created_at");