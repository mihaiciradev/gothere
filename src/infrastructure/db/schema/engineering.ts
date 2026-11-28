import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditActorType } from "./audit";
import { users } from "./identity";

export const incidentSeverity = pgEnum("incident_severity", ["P0", "P1", "P2", "P3"]);
export const incidentStatus = pgEnum("incident_status", ["open", "investigating", "mitigated", "resolved"]);
/** Real application telemetry vs. clearly labelled demonstration scenarios. Never mixed in one record. */
export const telemetryOrigin = pgEnum("telemetry_origin", ["live", "simulated"]);

/**
 * A detected problem, deduplicated by fingerprint: while an incident with the same fingerprint is unresolved, new
 * occurrences attach to it (partial unique index, drizzle/0010). Impact and analysis are computed, never typed in.
 */
export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fingerprint: text("fingerprint").notNull(),
    kind: text("kind").notNull(),
    source: text("source").notNull(),
    title: text("title").notNull(),
    severity: incidentSeverity("severity").notNull(),
    status: incidentStatus("status").notNull().default("open"),
    origin: telemetryOrigin("origin").notNull().default("live"),
    occurrences: integer("occurrences").notNull().default(1),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    technicalImpact: jsonb("technical_impact").$type<Record<string, unknown>>().notNull().default({}),
    commercialImpact: jsonb("commercial_impact").$type<Record<string, unknown>>().notNull().default({}),
    analysis: jsonb("analysis").$type<Record<string, unknown>>(),
    analysisSource: text("analysis_source"),
    analysisModel: text("analysis_model"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, { onDelete: "set null" }),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("incidents_status_severity_idx").on(t.status, t.severity, t.lastSeenAt),
    check("incidents_occurrences_positive", sql`${t.occurrences} >= 1`),
    check("incidents_resolved_at", sql`(${t.status} = 'resolved') = (${t.resolvedAt} IS NOT NULL)`),
    check("incidents_analysis_source", sql`${t.analysisSource} IS NULL OR ${t.analysisSource} IN ('rules', 'ai')`),
  ],
);

/** Every detected occurrence, sanitized before storage. Append-only (trigger). */
export const operationalEvents = pgTable(
  "operational_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    source: text("source").notNull(),
    kind: text("kind").notNull(),
    severity: incidentSeverity("severity").notNull(),
    fingerprint: text("fingerprint").notNull(),
    message: text("message").notNull(),
    correlationId: text("correlation_id"),
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    origin: telemetryOrigin("origin").notNull().default("live"),
    /** Detectors that re-scan a persistent condition (a dead job, an unpaid success) record it once per key. */
    dedupeKey: text("dedupe_key"),
    incidentId: uuid("incident_id").references(() => incidents.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("operational_events_dedupe_unique").on(t.fingerprint, t.dedupeKey).where(sql`${t.dedupeKey} IS NOT NULL`),
    index("operational_events_incident_idx").on(t.incidentId, t.occurredAt),
    index("operational_events_time_idx").on(t.occurredAt),
    check("operational_events_message_length", sql`char_length(${t.message}) <= 500`),
  ],
);

/** What happened to an incident and who did it: detection, recurrence, status, analysis, investigations. */
export const incidentTimeline = pgTable(
  "incident_timeline",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    kind: text("kind").notNull(),
    actorType: auditActorType("actor_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("incident_timeline_incident_idx").on(t.incidentId, t.at)],
);

export const investigationStatus = pgEnum("investigation_status", [
  "generated",
  "dispatch_requested",
  "dispatched",
  "completed",
  "failed",
]);

/**
 * A sanitized investigation package for an external coding agent. `generated` means exactly that: nothing was run.
 * Only `dispatched`/`completed` mean an external agent actually worked on it, and only after a human approval.
 */
export const investigationPackages = pgTable(
  "investigation_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    status: investigationStatus("status").notNull().default("generated"),
    report: jsonb("report").$type<Record<string, unknown>>().notNull(),
    executor: text("executor"),
    externalRef: text("external_ref"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("investigation_packages_incident_idx").on(t.incidentId, t.createdAt),
    check(
      "investigation_packages_executor",
      sql`${t.status} IN ('generated', 'dispatch_requested') OR (${t.executor} IS NOT NULL)`,
    ),
  ],
);
