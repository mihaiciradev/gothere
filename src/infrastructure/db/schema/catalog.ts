import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  char,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity";
import { organizations } from "./organizations";

export const eventStatus = pgEnum("event_status", ["draft", "published", "cancelled", "completed"]);
export const experienceStatus = pgEnum("experience_status", ["draft", "published", "archived"]);
export const experienceOrigin = pgEnum("experience_origin", ["manual", "ai_recommendation"]);
export const inventoryKind = pgEnum("inventory_kind", ["admission", "experience"]);
export const inventoryStatus = pgEnum("inventory_status", ["draft", "on_sale", "paused", "closed"]);
export const eventCategory = pgEnum("event_category", ["festival", "concert", "club", "culture"]);

const slugCheck = (name: string, column: AnyPgColumn) => check(name, sql`${column} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    description: text("description").notNull(),
    venueName: text("venue_name").notNull(),
    city: text("city").notNull(),
    countryCode: char("country_code", { length: 2 }).notNull(),
    /** IANA time zone used for presentation. Stored instants are UTC. */
    timeZone: text("time_zone").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: eventStatus("status").notNull().default("draft"),
    category: eventCategory("category").notNull().default("festival"),
    heroImageUrl: text("hero_image_url"),
    /** Attribution for licensed imagery, e.g. "Photo: Jane Doe / Unsplash". */
    heroImageCredit: text("hero_image_credit"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("events_id_org_unique").on(t.id, t.organizationId),
    index("events_org_idx").on(t.organizationId),
    index("events_status_starts_idx").on(t.status, t.startsAt),
    check("events_hero_image_https", sql`${t.heroImageUrl} IS NULL OR ${t.heroImageUrl} LIKE 'https://%'`),
    slugCheck("events_slug_format", t.slug),
    check("events_time_order", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

export const experiences = pgTable(
  "experiences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    eventId: uuid("event_id").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    location: text("location"),
    imageUrl: text("image_url"),
    imageCredit: text("image_credit"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: experienceStatus("status").notNull().default("draft"),
    origin: experienceOrigin("origin").notNull().default("manual"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Composite key guarantees an experience belongs to the same tenant as its event.
    foreignKey({
      name: "experiences_event_tenant_fk",
      columns: [t.eventId, t.organizationId],
      foreignColumns: [events.id, events.organizationId],
    }).onDelete("cascade"),
    unique("experiences_event_slug_unique").on(t.eventId, t.slug),
    unique("experiences_id_event_unique").on(t.id, t.eventId),
    index("experiences_org_idx").on(t.organizationId),
    slugCheck("experiences_slug_format", t.slug),
    check("experiences_time_order", sql`${t.endsAt} > ${t.startsAt}`),
    check(
      "experiences_published_at",
      sql`(${t.status} = 'published') = (${t.publishedAt} IS NOT NULL) OR ${t.status} = 'archived'`,
    ),
  ],
);

/**
 * A sellable, capacity-bounded unit: an admission ticket type or an experience session.
 * Availability = capacity - reserved - sold. Enforced by check constraints, mutated only by conditional updates.
 */
export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    eventId: uuid("event_id").notNull(),
    experienceId: uuid("experience_id"),
    kind: inventoryKind("kind").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    priceMinor: integer("price_minor").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    capacity: integer("capacity").notNull(),
    reserved: integer("reserved").notNull().default(0),
    sold: integer("sold").notNull().default(0),
    maxPerOrder: integer("max_per_order").notNull().default(6),
    status: inventoryStatus("status").notNull().default("draft"),
    salesStartAt: timestamp("sales_start_at", { withTimezone: true }),
    salesEndAt: timestamp("sales_end_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    foreignKey({
      name: "inventory_items_event_tenant_fk",
      columns: [t.eventId, t.organizationId],
      foreignColumns: [events.id, events.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "inventory_items_experience_event_fk",
      columns: [t.experienceId, t.eventId],
      foreignColumns: [experiences.id, experiences.eventId],
    }).onDelete("cascade"),
    // Target for composite FKs that pin reservation lines and tickets to the same event as the item.
    unique("inventory_items_id_event_unique").on(t.id, t.eventId),
    index("inventory_items_event_idx").on(t.eventId),
    index("inventory_items_experience_idx").on(t.experienceId),
    check("inventory_items_price_non_negative", sql`${t.priceMinor} >= 0`),
    check("inventory_items_currency_format", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("inventory_items_capacity_non_negative", sql`${t.capacity} >= 0`),
    check("inventory_items_reserved_non_negative", sql`${t.reserved} >= 0`),
    check("inventory_items_sold_non_negative", sql`${t.sold} >= 0`),
    check("inventory_items_no_oversell", sql`${t.reserved} + ${t.sold} <= ${t.capacity}`),
    check("inventory_items_max_per_order", sql`${t.maxPerOrder} BETWEEN 1 AND 20`),
    check(
      "inventory_items_kind_matches_experience",
      sql`(${t.kind} = 'experience') = (${t.experienceId} IS NOT NULL)`,
    ),
    check(
      "inventory_items_sales_window",
      sql`${t.salesStartAt} IS NULL OR ${t.salesEndAt} IS NULL OR ${t.salesEndAt} > ${t.salesStartAt}`,
    ),
  ],
);
