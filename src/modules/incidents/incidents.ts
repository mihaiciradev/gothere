import { and, asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbExecutor } from "@/infrastructure/db/client";
import { incidentTimeline, incidents, investigationPackages, operationalEvents, users } from "@/infrastructure/db/schema";
import { recordAudit } from "@/modules/audit";
import { type Actor, requirePlatformAdminById } from "@/modules/identity";
import { AppError } from "@/shared/errors";
import { assertUuid } from "@/shared/ids";
import { type IncidentKindId, isIncidentKind } from "./domain/catalogue";

export type IncidentRow = typeof incidents.$inferSelect;
export type IncidentStatus = IncidentRow["status"];

export const incidentFiltersSchema = z
  .object({
    status: z.enum(["open", "investigating", "mitigated", "resolved", "unresolved"]).optional(),
    severity: z.enum(["P0", "P1", "P2", "P3"]).optional(),
    origin: z.enum(["live", "simulated"]).optional(),
  })
  .strict();

/** Control Center reads and changes require the platform-admin role, re-read from the database. */
async function admin(db: DbExecutor, actor: Actor) {
  await requirePlatformAdminById(db, actor.userId);
}

export async function listIncidents(db: DbExecutor, actor: Actor, filters: unknown = {}) {
  await admin(db, actor);
  const f = incidentFiltersSchema.parse(filters);
  const conditions: SQL[] = [];
  if (f.status === "unresolved") conditions.push(inArray(incidents.status, ["open", "investigating", "mitigated"]));
  else if (f.status) conditions.push(eq(incidents.status, f.status));
  if (f.severity) conditions.push(eq(incidents.severity, f.severity));
  if (f.origin) conditions.push(eq(incidents.origin, f.origin));
  return db
    .select()
    .from(incidents)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(sql`${incidents.status} = 'resolved'`, asc(incidents.severity), desc(incidents.lastSeenAt))
    .limit(200);
}

export async function getIncident(db: DbExecutor, actor: Actor, incidentId: string) {
  await admin(db, actor);
  return loadIncident(db, incidentId);
}

/** Unchecked load for services that already authorized the caller (actions, the engineering agent). */
export async function loadIncident(db: DbExecutor, incidentId: string) {
  assertUuid(incidentId, "Incident");
  const [incident] = await db.select().from(incidents).where(eq(incidents.id, incidentId));
  if (!incident) throw new AppError("NOT_FOUND", "Incident not found.");
  const [events, timeline, packages] = await Promise.all([
    db.select().from(operationalEvents).where(eq(operationalEvents.incidentId, incidentId)).orderBy(desc(operationalEvents.occurredAt)).limit(50),
    db
      .select({ entry: incidentTimeline, actorName: users.name })
      .from(incidentTimeline)
      .leftJoin(users, eq(users.id, incidentTimeline.actorUserId))
      .where(eq(incidentTimeline.incidentId, incidentId))
      .orderBy(asc(incidentTimeline.at)),
    db.select().from(investigationPackages).where(eq(investigationPackages.incidentId, incidentId)).orderBy(desc(investigationPackages.createdAt)),
  ]);
  if (!isIncidentKind(incident.kind)) throw new AppError("INTERNAL", "Unknown incident kind.");
  return { incident: { ...incident, kind: incident.kind as IncidentKindId }, events, timeline, packages };
}

export type IncidentDetail = Awaited<ReturnType<typeof loadIncident>>;

const transitions: Record<IncidentStatus, readonly IncidentStatus[]> = {
  open: ["investigating", "mitigated", "resolved"],
  investigating: ["mitigated", "resolved"],
  mitigated: ["investigating", "resolved"],
  resolved: [],
};

export const statusChangeSchema = z
  .object({ status: z.enum(["investigating", "mitigated", "resolved"]), note: z.string().trim().max(1000).optional() })
  .strict()
  .refine((v) => v.status !== "resolved" || (v.note ?? "").length >= 3, { message: "Resolving needs a short note.", path: ["note"] });

/** Human status changes. Resolution is terminal: a recurrence opens a new incident (fingerprint index). */
export async function changeIncidentStatus(db: DbExecutor, actor: Actor, incidentId: string, input: unknown, options: { correlationId?: string } = {}) {
  assertUuid(incidentId, "Incident");
  const change = statusChangeSchema.parse(input);
  return db.transaction(async (tx) => {
    await admin(tx, actor);
    const [incident] = await tx.select().from(incidents).where(eq(incidents.id, incidentId)).for("update");
    if (!incident) throw new AppError("NOT_FOUND", "Incident not found.");
    if (!transitions[incident.status].includes(change.status)) {
      throw new AppError("PRECONDITION_FAILED", `An incident cannot move from ${incident.status} to ${change.status}.`);
    }
    const resolved = change.status === "resolved";
    await tx
      .update(incidents)
      .set({
        status: change.status,
        resolvedAt: resolved ? sql`now()` : null,
        resolvedByUserId: resolved ? actor.userId : null,
        resolutionNote: resolved ? change.note : null,
      })
      .where(eq(incidents.id, incidentId));
    await tx.insert(incidentTimeline).values({ incidentId, kind: "status_changed", actorType: "user", actorUserId: actor.userId, detail: { from: incident.status, to: change.status, note: change.note ?? null } });
    await recordAudit(tx, { actorType: "user", actorUserId: actor.userId, action: "incident.status", targetType: "incident", targetId: incidentId, outcome: "succeeded", correlationId: options.correlationId, metadata: { from: incident.status, to: change.status } });
    return { status: change.status };
  });
}

/** Timeline entry written by services acting on an incident (analysis, packages, investigation requests). */
export async function addTimelineEntry(
  db: DbExecutor,
  incidentId: string,
  entry: { kind: string; actorType: "user" | "ai_agent" | "system"; actorUserId?: string | null; detail?: Record<string, unknown> },
) {
  await db.insert(incidentTimeline).values({ incidentId, kind: entry.kind, actorType: entry.actorType, actorUserId: entry.actorUserId ?? null, detail: entry.detail ?? {} });
}

/** Stores a diagnosis (rules or AI) on the incident; the first analysis also moves an open incident to investigating. */
export async function saveAnalysis(
  db: DbExecutor,
  incidentId: string,
  analysis: { source: "rules" | "ai"; model: string | null; body: Record<string, unknown> },
  attribution: { actorType: "user" | "ai_agent" | "system"; actorUserId: string | null },
) {
  await db.transaction(async (tx) => {
    const [incident] = await tx.select().from(incidents).where(eq(incidents.id, incidentId)).for("update");
    if (!incident) throw new AppError("NOT_FOUND", "Incident not found.");
    await tx
      .update(incidents)
      .set({ analysis: analysis.body, analysisSource: analysis.source, analysisModel: analysis.model, status: incident.status === "open" ? "investigating" : incident.status })
      .where(eq(incidents.id, incidentId));
    await tx.insert(incidentTimeline).values({ incidentId, kind: "analysis", actorType: attribution.actorType, actorUserId: attribution.actorUserId, detail: { source: analysis.source, model: analysis.model } });
  });
}
