import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { events, experiences, inventoryItems } from "./catalog";
import { dataOrigin } from "./commerce";
import { users } from "./identity";
import { organizations } from "./organizations";

export const demandSignalKind = pgEnum("demand_signal_kind", ["waitlist_request", "sold_out_view", "search_unmatched"]);

/**
 * What attendees wanted and could not buy. `subject_key` is a keyed hash (never a raw user or visitor id), so
 * unique interest can be counted without storing identities; `user_id` is kept only for explicit waitlist requests
 * (the attendee asked to be told). Partial unique indexes make every signal idempotent per subject.
 */
export const demandSignals = pgTable(
  "demand_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: demandSignalKind("kind").notNull(),
    organizationId: uuid("organization_id"),
    eventId: uuid("event_id"),
    inventoryItemId: uuid("inventory_item_id"),
    subjectKey: text("subject_key").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    query: text("query"),
    origin: dataOrigin("origin").notNull().default("live"),
    occurredOn: date("occurred_on").notNull().default(sql`(now() AT TIME ZONE 'utc')::date`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "demand_signals_event_tenant_fk",
      columns: [t.eventId, t.organizationId],
      foreignColumns: [events.id, events.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "demand_signals_inventory_event_fk",
      columns: [t.inventoryItemId, t.eventId],
      foreignColumns: [inventoryItems.id, inventoryItems.eventId],
    }).onDelete("cascade"),
    uniqueIndex("demand_signals_waitlist_unique")
      .on(t.inventoryItemId, t.subjectKey)
      .where(sql`${t.kind} = 'waitlist_request'`),
    uniqueIndex("demand_signals_view_daily_unique")
      .on(t.inventoryItemId, t.subjectKey, t.occurredOn)
      .where(sql`${t.kind} = 'sold_out_view'`),
    uniqueIndex("demand_signals_search_daily_unique")
      .on(t.query, t.subjectKey, t.occurredOn)
      .where(sql`${t.kind} = 'search_unmatched'`),
    index("demand_signals_item_kind_idx").on(t.inventoryItemId, t.kind),
    index("demand_signals_org_idx").on(t.organizationId, t.createdAt),
    check(
      "demand_signals_shape",
      sql`CASE ${t.kind}
            WHEN 'search_unmatched' THEN ${t.query} IS NOT NULL AND ${t.inventoryItemId} IS NULL
            ELSE ${t.inventoryItemId} IS NOT NULL AND ${t.eventId} IS NOT NULL AND ${t.organizationId} IS NOT NULL
          END`,
    ),
    check("demand_signals_query_length", sql`${t.query} IS NULL OR char_length(${t.query}) BETWEEN 1 AND 120`),
  ],
);

export const recommendationStatus = pgEnum("recommendation_status", ["open", "drafted", "published", "dismissed"]);
export const narrativeSource = pgEnum("narrative_source", ["rules", "ai"]);

/**
 * An evidence-based commercial opportunity. Every number in `evidence`, `proposal` and `assumptions` is computed by
 * deterministic analysis (analytics/domain/opportunity.ts); the model may only write `narrative`, which is checked
 * against those numbers before it is stored.
 */
export const commercialRecommendations = pgTable(
  "commercial_recommendations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    eventId: uuid("event_id").notNull(),
    sourceInventoryItemId: uuid("source_inventory_item_id").notNull(),
    kind: text("kind").notNull(),
    status: recommendationStatus("status").notNull().default("open"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
    proposal: jsonb("proposal").$type<Record<string, unknown>>().notNull(),
    assumptions: jsonb("assumptions").$type<Record<string, unknown>>().notNull(),
    risks: jsonb("risks").$type<string[]>().notNull(),
    narrative: text("narrative").notNull(),
    narrativeSource: narrativeSource("narrative_source").notNull(),
    narrativeModel: text("narrative_model"),
    experienceId: uuid("experience_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    foreignKey({
      name: "commercial_recommendations_event_tenant_fk",
      columns: [t.eventId, t.organizationId],
      foreignColumns: [events.id, events.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "commercial_recommendations_source_event_fk",
      columns: [t.sourceInventoryItemId, t.eventId],
      foreignColumns: [inventoryItems.id, inventoryItems.eventId],
    }).onDelete("cascade"),
    foreignKey({
      name: "commercial_recommendations_experience_event_fk",
      columns: [t.experienceId, t.eventId],
      foreignColumns: [experiences.id, experiences.eventId],
    }).onDelete("no action"),
    unique("commercial_recommendations_source_kind_unique").on(t.sourceInventoryItemId, t.kind),
    unique("commercial_recommendations_experience_unique").on(t.experienceId),
    index("commercial_recommendations_org_idx").on(t.organizationId, t.status),
    check(
      "commercial_recommendations_experience_when_drafted",
      sql`${t.status} NOT IN ('drafted', 'published') OR ${t.experienceId} IS NOT NULL`,
    ),
  ],
);

export const actionInitiator = pgEnum("action_initiator", ["user", "ai_agent", "automation"]);
export const actionRequestStatus = pgEnum("action_request_status", [
  "pending_approval",
  "approved",
  "rejected",
  "expired",
  "executed",
  "failed",
]);

/**
 * A business action held for human approval. `params` are canonical and immutable; `params_hash` is sha256 of their
 * canonical JSON. The approver must submit the hash they reviewed, and execution flips `approved → executed` with a
 * conditional update, so a replay or a tampered request cannot execute. Transitions are guarded by a trigger.
 */
export const actionRequests = pgTable(
  "action_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actionId: text("action_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    initiator: actionInitiator("initiator").notNull(),
    risk: text("risk").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull(),
    paramsHash: text("params_hash").notNull(),
    status: actionRequestStatus("status").notNull().default("pending_approval"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    result: jsonb("result").$type<Record<string, unknown>>(),
    errorCode: text("error_code"),
    recommendationId: uuid("recommendation_id").references(() => commercialRecommendations.id, { onDelete: "set null" }),
    correlationId: text("correlation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("action_requests_open_unique")
      .on(t.actionId, t.organizationId, t.paramsHash)
      .where(sql`${t.status} IN ('pending_approval', 'approved')`),
    index("action_requests_org_status_idx").on(t.organizationId, t.status, t.createdAt),
    check("action_requests_hash_format", sql`${t.paramsHash} ~ '^[0-9a-f]{64}$'`),
    check("action_requests_risk", sql`${t.risk} IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')`),
    check(
      "action_requests_decision",
      sql`(${t.status} IN ('pending_approval', 'expired')) OR (${t.decidedByUserId} IS NOT NULL AND ${t.decidedAt} IS NOT NULL)`,
    ),
    check("action_requests_executed_at", sql`(${t.status} = 'executed') = (${t.executedAt} IS NOT NULL)`),
  ],
);

export const aiCallStatus = pgEnum("ai_call_status", [
  "reserved",
  "succeeded",
  "failed",
  "timeout",
  "refused",
  "invalid_output",
  "budget_exceeded",
]);

/**
 * One row per provider call (or per call refused by the budget). Cost is integer micro-USD. No prompt content.
 * A call first inserts a `reserved` row holding its worst-case cost (atomically against the monthly budget), then
 * settles it to the actual outcome and cost. Unsettled reservations keep counting, so a crash can only under-spend.
 */
export const aiUsageRecords = pgTable(
  "ai_usage_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    feature: text("feature").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    status: aiCallStatus("status").notNull(),
    organizationId: uuid("organization_id"),
    userId: uuid("user_id"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costMicroUsd: integer("cost_micro_usd").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    errorCode: text("error_code"),
    correlationId: text("correlation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_usage_records_created_idx").on(t.createdAt),
    check(
      "ai_usage_records_non_negative",
      sql`${t.inputTokens} >= 0 AND ${t.outputTokens} >= 0 AND ${t.costMicroUsd} >= 0 AND ${t.latencyMs} >= 0`,
    ),
  ],
);
