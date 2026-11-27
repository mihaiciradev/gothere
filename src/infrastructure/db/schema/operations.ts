import { sql } from "drizzle-orm";
import { char, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const jobStatus = pgEnum("job_status", ["queued", "running", "succeeded", "dead"]);

/** Durable background work. Claimed atomically with leases; handlers must be idempotent. */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: jobStatus("status").notNull().default("queued"),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedBy: text("locked_by"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastError: text("last_error"),
    /** Optional dedupe key: enqueueing the same key twice is a no-op. */
    dedupeKey: text("dedupe_key").unique(),
    correlationId: text("correlation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("jobs_claimable_idx").on(t.status, t.runAt),
    check("jobs_attempts_bounds", sql`${t.attempts} >= 0 AND ${t.maxAttempts} BETWEEN 1 AND 20`),
    check("jobs_lease_when_running", sql`${t.status} <> 'running' OR (${t.lockedBy} IS NOT NULL AND ${t.lockedUntil} IS NOT NULL)`),
  ],
);

/** Fixed-window counters for application endpoints (auth endpoints use Better Auth's own table). */
export const apiRateLimits = pgTable("api_rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});

export const simulatorPaymentStatus = pgEnum("simulator_payment_status", ["pending", "succeeded", "failed", "refunded"]);

/**
 * Ledger of the payment provider SIMULATOR. It stands in for an external provider's own records
 * (what the provider believes happened) and is never read by application logic except through the
 * provider interface. No real money is involved.
 */
export const simulatorPayments = pgTable("simulator_payments", {
  providerReference: text("provider_reference").primaryKey(),
  merchantReference: uuid("merchant_reference").notNull().unique(),
  amountMinor: integer("amount_minor").notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  status: simulatorPaymentStatus("status").notNull(),
  scenario: text("scenario").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
