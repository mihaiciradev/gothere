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

export const reservationStatus = pgEnum("reservation_status", [
  "active",
  "converted",
  "expired",
  "released",
]);
export const paymentProvider = pgEnum("payment_provider", ["simulator"]);
export const paymentAttemptStatus = pgEnum("payment_attempt_status", [
  "initiated",
  "pending",
  "succeeded",
  "failed",
  "unknown",
]);
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
    origin: dataOrigin("origin").notNull().default("live"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    tenantEventFk("reservations_event_tenant_fk", t),
    unique("reservations_user_idempotency_unique").on(t.userId, t.idempotencyKey),
    index("reservations_status_expires_idx").on(t.status, t.expiresAt),
    index("reservations_user_idx").on(t.userId),
    check("reservations_total_non_negative", sql`${t.totalMinor} >= 0`),
  ],
);

export const reservationItems = pgTable(
  "reservation_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    unitPriceMinor: integer("unit_price_minor").notNull(),
  },
  (t) => [
    unique("reservation_items_unique").on(t.reservationId, t.inventoryItemId),
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
    uniqueIndex("payment_attempts_one_success_per_reservation")
      .on(t.reservationId)
      .where(sql`${t.status} = 'succeeded'`),
    check("payment_attempts_amount_non_negative", sql`${t.amountMinor} >= 0`),
    // The MVP never processes real money.
    check("payment_attempts_simulated_only", sql`${t.simulated} = true`),
  ],
);

/** Inbound provider notifications, deduplicated by provider event id. */
export const paymentProviderEvents = pgTable(
  "payment_provider_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: paymentProvider("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    paymentAttemptId: uuid("payment_attempt_id").references(() => paymentAttempts.id, {
      onDelete: "restrict",
    }),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [unique("payment_provider_events_unique").on(t.provider, t.providerEventId)],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id")
      .notNull()
      .unique()
      .references(() => reservations.id, { onDelete: "restrict" }),
    paymentAttemptId: uuid("payment_attempt_id")
      .notNull()
      .unique()
      .references(() => paymentAttempts.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
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
    index("orders_user_idx").on(t.userId),
    index("orders_org_event_idx").on(t.organizationId, t.eventId),
    check("orders_total_non_negative", sql`${t.totalMinor} >= 0`),
  ],
);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
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
    unique("tickets_order_item_ordinal_unique").on(t.orderId, t.inventoryItemId, t.ordinal),
    index("tickets_user_idx").on(t.userId),
    check("tickets_ordinal_positive", sql`${t.ordinal} >= 1`),
  ],
);
