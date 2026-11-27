import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const auditActorType = pgEnum("audit_actor_type", ["user", "ai_agent", "system"]);
export const auditOutcome = pgEnum("audit_outcome", ["succeeded", "denied", "failed"]);

/**
 * Append-only. UPDATE and DELETE are rejected by a database trigger (see drizzle/0001_audit_append_only.sql).
 * Actor and organization ids are intentionally not foreign keys so records outlive the rows they describe.
 */
export const auditRecords = pgTable(
  "audit_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actorType: auditActorType("actor_type").notNull(),
    actorUserId: uuid("actor_user_id"),
    organizationId: uuid("organization_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    outcome: auditOutcome("outcome").notNull(),
    correlationId: text("correlation_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index("audit_records_org_time_idx").on(t.organizationId, t.occurredAt),
    index("audit_records_actor_time_idx").on(t.actorUserId, t.occurredAt),
  ],
);
