import { createHash } from "node:crypto";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/client";
import { incidentTimeline, incidents, operationalEvents } from "@/infrastructure/db/schema";
import { logger } from "@/infrastructure/logging/logger";
import { type IncidentKindId, type Severity, higherSeverity, incidentKinds } from "./domain/catalogue";
import { commercialImpact, technicalImpact } from "./domain/impact";
import { sanitizeText, sanitizeValue } from "./domain/sanitize";

export type OperationalEventInput = {
  kind: IncidentKindId;
  message: string;
  correlationId?: string | null;
  context?: Record<string, unknown>;
  /** What makes two occurrences "the same problem" (beyond the kind), e.g. route + error name. */
  fingerprintParts?: string[];
  /** Records a persistent condition once per key (e.g. one dead job), however often a detector re-scans it. */
  dedupeKey?: string;
  origin?: "live" | "simulated";
};

export type RecordedEvent = { eventId: string; incidentId: string; created: boolean; severity: Severity };

export const incidentFingerprint = (origin: string, kind: string, parts: string[] = []) =>
  createHash("sha256").update([origin, kind, ...parts].join("|")).digest("hex").slice(0, 32);

/** Recurrence is noted on the timeline at these counts, not on every occurrence. */
const RECURRENCE_MARKS = new Set([2, 5, 10, 25, 50, 100, 250, 500, 1000]);

/**
 * Records one sanitized operational event and attaches it to the open incident with the same fingerprint, creating
 * the incident on first sight (deduplication). Severity only ever rises. Impact is recomputed from the stored evidence.
 * Never throws: telemetry must not break the code path that reports a failure. Returns null when it could not record
 * or when the event was a duplicate (same dedupe key).
 */
export async function recordOperationalEvent(db: DbExecutor, input: OperationalEventInput): Promise<RecordedEvent | null> {
  try {
    const kind = incidentKinds[input.kind];
    const origin = input.origin ?? "live";
    const context = sanitizeValue(input.context ?? {}) as Record<string, unknown>;
    const severity = kind.severity(context);
    const fingerprint = incidentFingerprint(origin, input.kind, input.fingerprintParts);

    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`incident:${fingerprint}`}))`);
      const [event] = await tx
        .insert(operationalEvents)
        .values({
          source: kind.source,
          kind: input.kind,
          severity,
          fingerprint,
          message: sanitizeText(input.message, 500),
          correlationId: input.correlationId ?? null,
          context,
          origin,
          dedupeKey: input.dedupeKey ?? null,
        })
        .onConflictDoNothing({ target: [operationalEvents.fingerprint, operationalEvents.dedupeKey], where: sql`${operationalEvents.dedupeKey} IS NOT NULL` })
        .returning({ id: operationalEvents.id });
      if (!event) return null;

      const [open] = await tx
        .select()
        .from(incidents)
        .where(and(eq(incidents.fingerprint, fingerprint), ne(incidents.status, "resolved")))
        .for("update");

      let incidentId: string;
      let created = false;
      let current: Severity = severity;
      if (!open) {
        const [row] = await tx
          .insert(incidents)
          .values({ fingerprint, kind: input.kind, source: kind.source, title: sanitizeText(kind.title(context), 200), severity, origin })
          .returning({ id: incidents.id });
        incidentId = row!.id;
        created = true;
        await tx.insert(incidentTimeline).values({ incidentId, kind: "detected", actorType: "system", detail: { severity, eventId: event.id, correlationId: input.correlationId ?? null } });
      } else {
        incidentId = open.id;
        current = higherSeverity(open.severity, severity);
        const occurrences = open.occurrences + 1;
        await tx
          .update(incidents)
          .set({ occurrences, lastSeenAt: sql`now()`, severity: current })
          .where(eq(incidents.id, open.id));
        if (current !== open.severity) {
          await tx.insert(incidentTimeline).values({ incidentId, kind: "severity_changed", actorType: "system", detail: { from: open.severity, to: current, eventId: event.id } });
        }
        if (RECURRENCE_MARKS.has(occurrences)) {
          await tx.insert(incidentTimeline).values({ incidentId, kind: "recurred", actorType: "system", detail: { occurrences, eventId: event.id } });
        }
      }
      await tx.update(operationalEvents).set({ incidentId }).where(eq(operationalEvents.id, event.id));
      await refreshImpact(tx, incidentId, input.kind);
      return { eventId: event.id, incidentId, created, severity: current };
    });
  } catch (error) {
    logger.error("failed to record operational event", { kind: input.kind, error });
    return null;
  }
}

/** Recomputes technical and commercial impact from the latest 500 events of the incident. */
export async function refreshImpact(db: DbExecutor, incidentId: string, kind: IncidentKindId): Promise<void> {
  const events = await db
    .select({ id: operationalEvents.id, occurredAt: operationalEvents.occurredAt, correlationId: operationalEvents.correlationId, context: operationalEvents.context })
    .from(operationalEvents)
    .where(eq(operationalEvents.incidentId, incidentId))
    .orderBy(desc(operationalEvents.occurredAt))
    .limit(500);
  await db
    .update(incidents)
    .set({ technicalImpact: technicalImpact(events), commercialImpact: commercialImpact(kind, events) })
    .where(eq(incidents.id, incidentId));
}
