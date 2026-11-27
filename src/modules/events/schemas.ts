import { z } from "zod";

const slug = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens.");
const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const timeZone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "Unknown IANA time zone.");
const text = (max: number) => z.string().trim().min(1).max(max);

export const createEventSchema = z
  .object({
    slug,
    title: text(120),
    summary: text(280),
    description: text(5000),
    venueName: text(120),
    city: text(80),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    timeZone,
    startsAt: instant,
    endsAt: instant,
    heroImageUrl: z.url({ protocol: /^https$/ }).optional(),
  })
  .strict()
  .refine((e) => e.endsAt > e.startsAt, { message: "Event must end after it starts.", path: ["endsAt"] });

export const updateEventSchema = z
  .object({
    title: text(120),
    summary: text(280),
    description: text(5000),
    venueName: text(120),
    city: text(80),
    heroImageUrl: z.url({ protocol: /^https$/ }).nullable(),
    status: z.enum(["draft", "published", "cancelled", "completed"]),
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "Nothing to update.");

export const createExperienceSchema = z
  .object({
    slug,
    title: text(120),
    description: text(2000),
    category: text(40),
    location: text(120).optional(),
    startsAt: instant,
    endsAt: instant,
    capacity: z.number().int().min(1).max(100_000),
    priceMinor: z.number().int().min(0).max(10_000_000),
    currency: z.enum(["EUR", "RON"]).default("EUR"),
    maxPerOrder: z.number().int().min(1).max(20).default(4),
  })
  .strict()
  .refine((e) => e.endsAt > e.startsAt, { message: "Experience must end after it starts.", path: ["endsAt"] });

export type CreateEventInput = z.input<typeof createEventSchema>;
export type CreateExperienceInput = z.input<typeof createExperienceSchema>;
