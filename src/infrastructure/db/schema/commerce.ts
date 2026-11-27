import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  char,
  check,
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
import { events, inventoryItems } from "./catalog";
import { users } from "./identity";

/** Distinguishes seeded demonstration history from activity produced by real application workflows. */
export const dataOrigin = pgEnum("data_origin", ["seed", "live"]);

export const reservationStatus = pgEnum("reservation_status", ["active", "converted", "expired", "released"]);
export const paymentProvider = pgEnum("payment_provider", ["simulator"]);
/** What the provider says happened. Every provider success is recordable; it never implies acceptance. */
export const paymentAttemptStatus = pgEnum("payment_attempt_status", [
  "initiated",
  "pending",
  "succeeded",
  "failed",
  "unknown",
]);
/** What the application decided to do with a provider success. */
export const paymentDisposition = pgEnum("payment_disposition", ["none", "accepted", "refund_required", "refunded"]);
export const orderStatus = pgEnum("order_status", ["confirmed", "refund_required", "refunded"]);
export const ticketStatus = pgEnum("ticket_status", ["valid", "void", "checked_in"]);

const tenantEventFk = (name: string, t: { eventId: AnyPgColumn; organizationId: AnyPgColumn }) =>
  foreignKey({ name, columns: [t.eventId, t.organizationId], foreignColumns: [events.id, events.organizationId] });

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id").notNull(),
    eventId: uuid("event_id").notNull(),
    status: reservationStatus("status").notNull().default("active"),
    currency: char("currency", { length: 3 }).notNull(),
    totalMinor: integer("total_minor").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    /** sha256 of the canonical request; reusing a key with different parameters is rejected. */
    requestHash: text("request_hash").notNull(),
    origin: dataOrigin("origin").notNull().default("live"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    tenantEventFk("reservations_event_tenant_fk", t),
    unique("reservations_user_idempotency_unique").on(t.userId, t.idempotencyKey),
    unique("reservations_id_event_unique").on(t.id, t.eventId),
    unique("reservations_id_user_event_unique").on(t.id, t.userId, t.eventId),
    index("reservations_status_expires_idx").on(t.status, t.expiresAt),
    index("reservations_user_status_idx").on(t.userId, t.status),
    check("reservations_total_non_negative", sql`${t.totalMinor} >= 0`),
    check("reservations_closed_at", sql`(${t.status} = 'active') = (${t.closedAt} IS NULL)`),
  ],
);

export const reservationItems = pgTable(
  "reservation_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id").notNull(),
    eventId: uuid("event_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceMinor: integer("unit_price_minor").notNull(),
  },
  (t) => [
    // Both FKs share event_id: a line can only hold inventory of its reservation's event.
    foreignKey({
      name: "reservation_items_reservation_event_fk",
      columns: [t.reservationId, t.eventId],
      foreignColumns: [reservations.id, reservations.eventId],
    }).onDelete("cascade"),
    foreignKey({
      name: "reservation_items_inventory_event_fk",
      columns: [t.inventoryItemId, t.eventId],
      foreignColumns: [inventoryItems.id, inventoryItems.eventId],
    }).onDelete("restrict"),
    unique("reservation_items_unique").on(t.reservationId, t.inventoryItemId),
    index("reservation_items_inventory_idx").on(t.inventoryItemId),
    check("reservation_items_quantity_positive", sql`${t.quantity} > 0`),
    check("reservation_items_price_non_negative", sql`${t.unitPriceMinor} >= 0`),
  ],
);

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "restrict" }),
    provider: paymentProvider("provider").notNull().default("simulator"),
    providerReference: text("provider_reference").unique(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: paymentAttemptStatus("status").notNull().default("initiated"),
    disposition: paymentDisposition("disposition").notNull().default("none"),
    amountMinor: integer("amount_minor").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    failureCode: text("failure_code"),
    simulated: boolean("simulated").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    unique("payment_attempts_reservation_idempotency_unique").on(t.reservationId, t.idempotencyKey),
    unique("payment_attempts_id_reservation_unique").on(t.id, t.reservationId),
    // Application acceptance, not provider success, is unique per reservation.
    uniqueIndex("payment_attempts_one_accepted_per_reservation")
      .on(t.reservationId)
      .where(sql`${t.disposition} = 'accepted'`),
    // At most one attempt awaiting the provider at a time; `unknown` does not block a retry.
    uniqueIndex("payment_attempts_one_in_flight_per_reservation")
      .on(t.reservationId)
      .where(sql`${t.status} IN ('initiated', 'pending')`),
    index("payment_attempts_status_idx").on(t.status, t.updatedAt),
    check("payment_attempts_amount_non_negative", sql`${t.amountMinor} >= 0`),
    check("payment_attempts_simulated_only", sql`${t.simulated} = true`),
    check(
      "payment_attempts_disposition_requires_success",
      sql`${t.disposition} = 'none' OR ${t.status} = 'succeeded'`,
    ),
  ],
);

/**
 * Inbound provider outcomes (webhooks, synchronous responses, reconciliation queries).
 * Recorded in their own transaction before processing so a provider success can never be lost.
 */
export const paymentProviderEvents = pgTable(
  "payment_provider_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: paymentProvider("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    providerReference: text("provider_reference").notNull(),
    paymentAttemptId: uuid("payment_attempt_id").references(() => paymentAttempts.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    outcome: text("outcome"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    unique("payment_provider_events_unique").on(t.provider, t.providerEventId),
    index("payment_provider_events_unprocessed_idx").on(t.receivedAt).where(sql`${t.processedAt} IS NULL`),
    check("payment_provider_events_outcome_when_processed", sql`(${t.processedAt} IS NULL) = (${t.outcome} IS NULL)`),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id").notNull().unique(),
    paymentAttemptId: uuid("payment_attempt_id").notNull().unique(),
    userId: uuid("user_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    eventId: uuid("event_id").notNull(),
    status: orderStatus("status").notNull().default("confirmed"),
    totalMinor: integer("total_minor").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    origin: dataOrigin("origin").notNull().default("live"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantEventFk("orders_event_tenant_fk", t),
    // Order must match its reservation's user and event, and be paid by an attempt of that reservation.
    foreignKey({
      name: "orders_reservation_user_event_fk",
      columns: [t.reservationId, t.userId, t.eventId],
      foreignColumns: [reservations.id, reservations.userId, reservations.eventId],
    }).onDelete("restrict"),
    foreignKey({
      name: "orders_payment_reservation_fk",
      columns: [t.paymentAttemptId, t.reservationId],
      foreignColumns: [paymentAttempts.id, paymentAttempts.reservationId],
    }).onDelete("restrict"),
    unique("orders_id_reservation_user_event_unique").on(t.id, t.reservationId, t.userId, t.eventId),
    index("orders_user_idx").on(t.userId),
    index("orders_org_event_idx").on(t.organizationId, t.eventId),
    check("orders_total_non_negative", sql`${t.totalMinor} >= 0`),
  ],
);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull(),
    reservationId: uuid("reservation_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    userId: uuid("user_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    eventId: uuid("event_id").notNull(),
    /** 1..quantity within an order line; the unique key makes issuance idempotent. */
    ordinal: integer("ordinal").notNull(),
    code: text("code").notNull().unique(),
    status: ticketStatus("status").notNull().default("valid"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantEventFk("tickets_event_tenant_fk", t),
    foreignKey({
      name: "tickets_order_fk",
      columns: [t.orderId, t.reservationId, t.userId, t.eventId],
      foreignColumns: [orders.id, orders.reservationId, orders.userId, orders.eventId],
    }).onDelete("restrict"),
    // A ticket can only be issued for an item that was actually reserved on that order's reservation.
    foreignKey({
      name: "tickets_reservation_item_fk",
      columns: [t.reservationId, t.inventoryItemId],
      foreignColumns: [reservationItems.reservationId, reservationItems.inventoryItemId],
    }).onDelete("restrict"),
    unique("tickets_order_item_ordinal_unique").on(t.orderId, t.inventoryItemId, t.ordinal),
    index("tickets_user_idx").on(t.userId),
    check("tickets_ordinal_positive", sql`${t.ordinal} >= 1`),
  ],
);
