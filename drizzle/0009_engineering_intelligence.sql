CREATE TYPE "public"."incident_severity" AS ENUM('P0', 'P1', 'P2', 'P3');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('open', 'investigating', 'mitigated', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."investigation_status" AS ENUM('generated', 'dispatch_requested', 'dispatched', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."telemetry_origin" AS ENUM('live', 'simulated');--> statement-breakpoint
CREATE TABLE "incident_timeline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_user_id" uuid,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint" text NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"title" text NOT NULL,
	"severity" "incident_severity" NOT NULL,
	"status" "incident_status" DEFAULT 'open' NOT NULL,
	"origin" "telemetry_origin" DEFAULT 'live' NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"technical_impact" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"commercial_impact" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"analysis" jsonb,
	"analysis_source" text,
	"analysis_model" text,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" uuid,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_occurrences_positive" CHECK ("incidents"."occurrences" >= 1),
	CONSTRAINT "incidents_resolved_at" CHECK (("incidents"."status" = 'resolved') = ("incidents"."resolved_at" IS NOT NULL)),
	CONSTRAINT "incidents_analysis_source" CHECK ("incidents"."analysis_source" IS NULL OR "incidents"."analysis_source" IN ('rules', 'ai'))
);
--> statement-breakpoint
CREATE TABLE "investigation_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"status" "investigation_status" DEFAULT 'generated' NOT NULL,
	"report" jsonb NOT NULL,
	"executor" text,
	"external_ref" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investigation_packages_executor" CHECK ("investigation_packages"."status" IN ('generated', 'dispatch_requested') OR ("investigation_packages"."executor" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "operational_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"severity" "incident_severity" NOT NULL,
	"fingerprint" text NOT NULL,
	"message" text NOT NULL,
	"correlation_id" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"origin" "telemetry_origin" DEFAULT 'live' NOT NULL,
	"incident_id" uuid,
	CONSTRAINT "operational_events_message_length" CHECK (char_length("operational_events"."message") <= 500)
);
--> statement-breakpoint
ALTER TABLE "action_requests" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "incident_timeline" ADD CONSTRAINT "incident_timeline_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_timeline" ADD CONSTRAINT "incident_timeline_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_packages" ADD CONSTRAINT "investigation_packages_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_packages" ADD CONSTRAINT "investigation_packages_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_events" ADD CONSTRAINT "operational_events_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incident_timeline_incident_idx" ON "incident_timeline" USING btree ("incident_id","at");--> statement-breakpoint
CREATE INDEX "incidents_status_severity_idx" ON "incidents" USING btree ("status","severity","last_seen_at");--> statement-breakpoint
CREATE INDEX "investigation_packages_incident_idx" ON "investigation_packages" USING btree ("incident_id","created_at");--> statement-breakpoint
CREATE INDEX "operational_events_incident_idx" ON "operational_events" USING btree ("incident_id","occurred_at");--> statement-breakpoint
CREATE INDEX "operational_events_time_idx" ON "operational_events" USING btree ("occurred_at");