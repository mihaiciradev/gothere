import { and, desc, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/client";
import { investigationPackages } from "@/infrastructure/db/schema";
import { AppError } from "@/shared/errors";
import { assertUuid } from "@/shared/ids";
import { addTimelineEntry, loadIncident } from "./incidents";
import { buildDiagnosticReport, renderReportMarkdown } from "./report";

export type Attribution = { actorType: "user" | "ai_agent" | "system"; actorUserId: string | null };

/**
 * Creates (or returns, within an hour) a sanitized investigation package for an external coding agent. Status
 * `generated` means nothing has run: the package is a document until a human-approved dispatch executes it.
 */
export async function generateInvestigationPackage(
  db: DbExecutor,
  incidentId: string,
  environment: { appEnv: string; commit: string | null },
  attribution: Attribution,
) {
  const detail = await loadIncident(db, incidentId);
  const [recent] = await db
    .select()
    .from(investigationPackages)
    .where(and(eq(investigationPackages.incidentId, incidentId), eq(investigationPackages.status, "generated"), sql`${investigationPackages.createdAt} > now() - interval '1 hour'`))
    .orderBy(desc(investigationPackages.createdAt))
    .limit(1);
  if (recent) return { packageId: recent.id, status: recent.status, reused: true };

  const report = buildDiagnosticReport(detail, environment);
  const [created] = await db
    .insert(investigationPackages)
    .values({ incidentId, status: "generated", report: { ...report, markdown: renderReportMarkdown(report) }, createdByUserId: attribution.actorUserId })
    .returning({ id: investigationPackages.id, status: investigationPackages.status });
  await addTimelineEntry(db, incidentId, { kind: "investigation_package", actorType: attribution.actorType, actorUserId: attribution.actorUserId, detail: { packageId: created!.id, executed: false } });
  return { packageId: created!.id, status: created!.status, reused: false };
}

export async function getInvestigationPackage(db: DbExecutor, packageId: string) {
  assertUuid(packageId, "Investigation package");
  const [row] = await db.select().from(investigationPackages).where(eq(investigationPackages.id, packageId));
  if (!row) throw new AppError("NOT_FOUND", "Investigation package not found.");
  return row;
}

/** Marks that a human-approval request for external execution exists. Execution itself is a separate, approved step. */
export async function markDispatchRequested(db: DbExecutor, packageId: string) {
  await db
    .update(investigationPackages)
    .set({ status: "dispatch_requested" })
    .where(and(eq(investigationPackages.id, packageId), eq(investigationPackages.status, "generated")));
}

/** Records the outcome of an approved dispatch attempt. Only an adapter that really started a run may pass `dispatched`. */
export async function recordDispatchOutcome(
  db: DbExecutor,
  packageId: string,
  outcome: { status: "dispatched" | "failed"; executor: string; externalRef?: string | null },
) {
  await db
    .update(investigationPackages)
    .set({ status: outcome.status, executor: outcome.executor, externalRef: outcome.externalRef ?? null })
    .where(eq(investigationPackages.id, packageId));
}
