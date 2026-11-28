import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { decideActionRequest, invokeAction } from "@/actions";
import { createAiGateway, runEngineeringAgent } from "@/ai";
import { route } from "@/app/api/_lib/http";
import { runOperationsCycle } from "@/composition/runtime";
import { actionRequests, incidentTimeline, incidents, inventoryItems, investigationPackages, jobs, operationalEvents } from "@/infrastructure/db/schema";
import {
  buildDiagnosticReport,
  changeIncidentStatus,
  createSimulatedIncident,
  detectAnomalies,
  healthSnapshot,
  listIncidents,
  loadIncident,
  recordOperationalEvent,
} from "@/modules/incidents";
import { createReservation } from "@/modules/reservations";
import { expectDbRejection } from "./support/expect-db-error";
import { actorFor, createActor, createSellableEvent, createUser, expectAppError, forceOverdue, key, openTestDatabase } from "./support/fixtures";
import { fakeProvider, lastToolResults, toolCall } from "./support/intelligence";

const { db, pool } = openTestDatabase(10);
afterAll(() => pool.end());

const admin = async () => actorFor(await createUser(db, { platformRole: "platform_admin" }));
const unique = () => randomUUID().slice(0, 8);
const httpEvent = (path: string, parts = [unique()]) =>
  recordOperationalEvent(db, { kind: "http.unhandled_error", message: "TypeError: boom", context: { method: "POST", path, errorName: "TypeError" }, fingerprintParts: parts });
const incidentOf = async (id: string) => (await db.select().from(incidents).where(eq(incidents.id, id)))[0]!;

describe("detection and deduplication", () => {
  it("attaches repeated occurrences to one open incident, and opens a new one after resolution", async () => {
    const parts = [unique()];
    const first = await httpEvent("/api/events", parts);
    const second = await httpEvent("/api/events", parts);
    expect(first!.created).toBe(true);
    expect(second).toMatchObject({ incidentId: first!.incidentId, created: false });
    expect(await incidentOf(first!.incidentId)).toMatchObject({ occurrences: 2, severity: "P2", status: "open", origin: "live" });
    expect((await incidentOf(first!.incidentId)).technicalImpact).toMatchObject({ occurrences: 2, routes: ["/api/events"] });

    await changeIncidentStatus(db, await admin(), first!.incidentId, { status: "resolved", note: "Fixed in PR" });
    const third = await httpEvent("/api/events", parts);
    expect(third!.created).toBe(true);
    expect(third!.incidentId).not.toBe(first!.incidentId);
  });

  it("only ever raises severity, and notes the change on the timeline", async () => {
    const parts = [unique()];
    const minor = await httpEvent("/api/events", parts);
    const major = await httpEvent("/api/reservations/:id/payments", parts);
    expect(major!.incidentId).toBe(minor!.incidentId);
    expect((await incidentOf(minor!.incidentId)).severity).toBe("P1");
    await httpEvent("/api/events", parts);
    expect((await incidentOf(minor!.incidentId)).severity).toBe("P1");
    const changes = await db.select().from(incidentTimeline).where(and(eq(incidentTimeline.incidentId, minor!.incidentId), eq(incidentTimeline.kind, "severity_changed")));
    expect(changes).toHaveLength(1);
  });

  it("records a persistent condition once per dedupe key, however often it is scanned", async () => {
    const input = { kind: "jobs.dead" as const, message: "dead", context: { jobType: "test.x", jobId: unique() }, fingerprintParts: [unique()], dedupeKey: unique() };
    expect(await recordOperationalEvent(db, input)).not.toBeNull();
    expect(await recordOperationalEvent(db, input)).toBeNull();
  });

  it("sanitizes messages and contexts before storing them, and keeps evidence append-only", async () => {
    const recorded = await recordOperationalEvent(db, {
      kind: "http.unhandled_error",
      message: "Failed for maya@attendee.gothere.test using postgres://app:hunter2@db.example/neon and Bearer abc.def.ghi",
      context: { path: "/api/events", password: "hunter2", headers: { authorization: "Bearer x" }, note: "card 4242 4242 4242 4242" },
      fingerprintParts: [unique()],
    });
    const [event] = await db.select().from(operationalEvents).where(eq(operationalEvents.id, recorded!.eventId));
    const stored = JSON.stringify(event);
    for (const secret of ["maya@attendee", "hunter2", "abc.def.ghi", "4242 4242"]) expect(stored).not.toContain(secret);
    expect(event!.message).toContain("[email]");
    await expectDbRejection(db.update(operationalEvents).set({ message: "rewritten" }).where(eq(operationalEvents.id, event!.id)), "operational_events_append_only");
    await expectDbRejection(db.delete(operationalEvents).where(eq(operationalEvents.id, event!.id)), "operational_events_append_only");
  });

  it("turns an unhandled API error into an incident with the route, error name and correlation id", async () => {
    const marker = `boom-${unique()}`;
    const handler = route(async () => {
      throw new Error(marker);
    });
    const response = await handler(new Request("http://localhost:3000/api/reservations/7d1c3c0e-8a5a-4b8e-9d5e-1f0f0c0b0a09/payments", { method: "POST" }), { params: Promise.resolve({}) });
    expect(response.status).toBe(500);
    const correlationId = response.headers.get("x-request-id");
    let event;
    for (let i = 0; i < 40 && !event; i++) {
      [event] = await db.select().from(operationalEvents).where(eq(operationalEvents.correlationId, correlationId!));
      if (!event) await new Promise((r) => setTimeout(r, 50));
    }
    expect(event).toMatchObject({ kind: "http.unhandled_error", severity: "P1", context: expect.objectContaining({ method: "POST", path: "/api/reservations/:id/payments", errorName: "Error" }) });
    expect(event!.message).toContain(marker);
  });
});

describe("detectors and commercial impact", () => {
  it("detects an inventory counter below its active holds, with the value at risk, once per day", async () => {
    const { event, admission } = await createSellableEvent(db, 10);
    await createReservation(db, await createActor(db), { eventId: event.id, items: [{ inventoryItemId: admission.id, quantity: 3 }] }, { idempotencyKey: key() });
    await db.update(inventoryItems).set({ reserved: 1 }).where(eq(inventoryItems.id, admission.id));

    expect(await detectAnomalies(db)).toBeGreaterThanOrEqual(1);
    const [event1] = await db.select().from(operationalEvents).where(and(eq(operationalEvents.kind, "inventory.counter_mismatch"), sql`${operationalEvents.context}->>'inventoryItemId' = ${admission.id}`));
    const incident = await incidentOf(event1!.incidentId!);
    expect(incident).toMatchObject({ severity: "P1", kind: "inventory.counter_mismatch" });
    expect(incident.commercialImpact).toMatchObject({ unitsAtRisk: 2, valueAtRiskMinor: 10_000, currency: "EUR", affectedItems: 1 });

    await detectAnomalies(db);
    expect((await incidentOf(incident.id)).occurrences).toBe(1);
    await db.update(inventoryItems).set({ reserved: 3 }).where(eq(inventoryItems.id, admission.id));
  });

  it("raises an incident when the expiry sweep has to skip a hold, and keeps maintenance running", async () => {
    const { event, admission } = await createSellableEvent(db, 10);
    const hold = await createReservation(db, await createActor(db), { eventId: event.id, items: [{ inventoryItemId: admission.id, quantity: 2 }] }, { idempotencyKey: key() });
    await db.update(inventoryItems).set({ reserved: 0 }).where(eq(inventoryItems.id, admission.id));
    await forceOverdue(db, hold.id);

    const cycle = await runOperationsCycle(db, { jobLimit: 1 });
    expect(cycle.failedStages).toEqual([]);
    const [skipped] = await db.select().from(operationalEvents).where(and(eq(operationalEvents.kind, "reservations.expiry_failed"), sql`${operationalEvents.context}->>'reservationId' = ${hold.id}`));
    const incident = await incidentOf(skipped!.incidentId!);
    expect(incident.commercialImpact).toMatchObject({ unitsAtRisk: 2, valueAtRiskMinor: 10_000, affectedHolds: 1 });
    await db.update(inventoryItems).set({ reserved: 2 }).where(eq(inventoryItems.id, admission.id));
  });

  it("raises a P1 incident for a dead payment job", async () => {
    const [job] = await db.insert(jobs).values({ type: "payments.simulated_refund", payload: { attemptId: randomUUID() }, status: "dead", attempts: 5, lastError: "provider down" }).returning();
    await detectAnomalies(db);
    const [event] = await db.select().from(operationalEvents).where(eq(operationalEvents.dedupeKey, job!.id));
    expect(await incidentOf(event!.incidentId!)).toMatchObject({ kind: "jobs.dead", severity: "P1" });
    await db.delete(jobs).where(eq(jobs.id, job!.id));
  });
});

describe("Control Center authorization", () => {
  it("is for platform administrators only, read from the database", async () => {
    const attendee = await createActor(db);
    await expectAppError(listIncidents(db, attendee), "FORBIDDEN");
    await expectAppError(healthSnapshot(db, attendee), "FORBIDDEN");
    // A forged session role does not help: the role is re-read from the users table.
    await expectAppError(listIncidents(db, { ...attendee, platformRole: "platform_admin" }), "FORBIDDEN");
    const recorded = await httpEvent("/api/events");
    await expectAppError(
      invokeAction({ db, actor: attendee, organizationId: null, initiator: "user" }, "incident.read_report", { incidentId: recorded!.incidentId }),
      "FORBIDDEN",
    );
  });

  it("refuses platform actions with an organization context", async () => {
    const recorded = await httpEvent("/api/events");
    await expectAppError(
      invokeAction({ db, actor: await admin(), organizationId: randomUUID(), initiator: "user" }, "incident.read_report", { incidentId: recorded!.incidentId }),
      "FORBIDDEN",
    );
  });
});

describe("governed engineering actions", () => {
  it("never runs an external investigation without approval, even for a P0 or a human request, and never claims it ran", async () => {
    const operator = await admin();
    const recorded = await httpEvent("/api/reservations/:id/payments");
    await db.update(incidents).set({ severity: "P0" }).where(eq(incidents.id, recorded!.incidentId));
    const gateway = createAiGateway({ provider: null, pricing: { inputMicroUsdPerMTok: 1, outputMicroUsdPerMTok: 1 }, monthlyBudgetMicroUsd: 0, runTimeoutMs: 1000 });

    const agent = await runEngineeringAgent({ db, gateway }, operator, recorded!.incidentId);
    expect(agent).toMatchObject({ mode: "automation", analysis: { source: "rules" }, dispatchRequestId: null });
    const [pkg] = await db.select().from(investigationPackages).where(eq(investigationPackages.id, agent.packageId!));
    expect(pkg).toMatchObject({ status: "generated", executor: null });
    expect(JSON.stringify(pkg!.report)).toContain("Open a pull request for human review");
    expect((await incidentOf(recorded!.incidentId)).status).toBe("investigating");

    const ctx = { db, actor: operator, organizationId: null, initiator: "user" as const };
    const outcome = await invokeAction(ctx, "incident.dispatch_investigation", { packageId: pkg!.id });
    expect(outcome.status).toBe("pending_approval");
    const again = await invokeAction(ctx, "incident.dispatch_investigation", { packageId: pkg!.id });
    expect(again.status === "pending_approval" && again.request.duplicate).toBe(true);

    const request = outcome.status === "pending_approval" ? outcome.request : null;
    const decided = await decideActionRequest(db, operator, request!.id, { decision: "approve", paramsHash: request!.paramsHash }, { platformOnly: true });
    expect(decided).toMatchObject({ status: "failed", error: { code: "PRECONDITION_FAILED", message: expect.stringMatching(/not executed/) } });
    const [after] = await db.select().from(investigationPackages).where(eq(investigationPackages.id, pkg!.id));
    expect(after!.status).toBe("generated");
    const [row] = await db.select().from(actionRequests).where(eq(actionRequests.id, request!.id));
    expect(row).toMatchObject({ status: "failed", organizationId: null, risk: "HIGH" });
  });

  it("lets only platform administrators decide platform requests, and never through an organization route", async () => {
    const operator = await admin();
    const recorded = await httpEvent("/api/events");
    const pkg = await invokeAction({ db, actor: operator, organizationId: null, initiator: "user" }, "incident.generate_investigation_package", { incidentId: recorded!.incidentId });
    const outcome = await invokeAction({ db, actor: operator, organizationId: null, initiator: "user" }, "incident.dispatch_investigation", { packageId: (pkg as { output: { packageId: string } }).output.packageId });
    const request = outcome.status === "pending_approval" ? outcome.request : null;
    await expectAppError(decideActionRequest(db, await createActor(db), request!.id, { decision: "approve", paramsHash: request!.paramsHash }), "FORBIDDEN");
    await expectAppError(decideActionRequest(db, operator, request!.id, { decision: "approve", paramsHash: request!.paramsHash }, { organizationId: randomUUID() }), "NOT_FOUND");
    expect(await decideActionRequest(db, operator, request!.id, { decision: "reject", paramsHash: request!.paramsHash }, { platformOnly: true })).toEqual({ status: "rejected" });
  });
});

describe("engineering agent with a model", () => {
  const gatewayWith = (provider: ReturnType<typeof fakeProvider>) =>
    createAiGateway({ provider, pricing: { inputMicroUsdPerMTok: 100_000, outputMicroUsdPerMTok: 500_000 }, monthlyBudgetMicroUsd: 1_000_000_000, runTimeoutMs: 10_000 });

  it("keeps causes that cite real evidence, sees only the sanitized report, and can only request (not run) a dispatch", async () => {
    const operator = await admin();
    const recorded = await recordOperationalEvent(db, {
      kind: "http.unhandled_error",
      message: "TypeError for luca@attendee.gothere.test",
      context: { method: "POST", path: "/api/reservations", errorName: "TypeError" },
      fingerprintParts: [unique()],
    });
    const evidenceId = recorded!.eventId;
    let packageId = "";
    const provider = fakeProvider((request, turn) => {
      if (turn === 0) return toolCall("incident_generate_investigation_package", { incidentId: recorded!.incidentId });
      if (turn === 1) {
        packageId = (lastToolResults(request)[0]!.body.data as { packageId: string }).packageId;
        return toolCall("incident_dispatch_investigation", { packageId });
      }
      return toolCall("diagnosis", {
        summary: "A null price reaches the reservation service.",
        likelyCauses: [
          { cause: "Missing price on an inventory item", evidence: [evidenceId] },
          { cause: "Invented cause", evidence: ["not-a-real-event-id"] },
        ],
        checks: ["Check the item"],
        recovery: ["Ship a fix via PR"],
        regressionTest: "Reserve an item without a price and expect a 422.",
        confidence: "medium",
      });
    });
    const result = await runEngineeringAgent({ db, gateway: gatewayWith(provider) }, operator, recorded!.incidentId);

    expect(result.mode).toBe("ai");
    expect((result.analysis.body as { likelyCauses: { cause: string }[] }).likelyCauses.map((c) => c.cause)).toEqual(["Missing price on an inventory item"]);
    expect(JSON.stringify(provider.requests[0]!.messages)).not.toContain("luca@attendee");
    const [request] = await db.select().from(actionRequests).where(eq(actionRequests.id, result.dispatchRequestId!));
    expect(request).toMatchObject({ status: "pending_approval", initiator: "ai_agent", actionId: "incident.dispatch_investigation" });
    expect(provider.requests[0]!.tools.map((t) => t.name)).not.toContain("approve");
    expect((await incidentOf(recorded!.incidentId)).analysisSource).toBe("ai");
  });

  it("falls back to the runbook when the model cites no real evidence", async () => {
    const operator = await admin();
    const recorded = await httpEvent("/api/events");
    const provider = fakeProvider(() =>
      toolCall("diagnosis", { summary: "Guesswork only here.", likelyCauses: [{ cause: "Cosmic rays", evidence: ["made-up"] }], checks: ["x x"], recovery: ["y y"], regressionTest: "zzzzzzzzzzzz", confidence: "high" }),
    );
    const result = await runEngineeringAgent({ db, gateway: gatewayWith(provider) }, operator, recorded!.incidentId);
    expect(result).toMatchObject({ mode: "automation", analysis: { source: "rules" }, notice: expect.stringMatching(/not grounded/) });
  });
});

describe("simulated incidents", () => {
  it("are labelled, kept apart from live telemetry, and refused where simulations are disabled", async () => {
    const operator = await admin();
    const before = await healthSnapshot(db, operator);
    const { incidentId } = await createSimulatedIncident(db, operator, { scenario: "payment-unreconciled" }, { allowed: true });
    const detail = await loadIncident(db, incidentId);
    expect(detail.incident.origin).toBe("simulated");
    expect(detail.events.every((e) => e.origin === "simulated")).toBe(true);
    const after = await healthSnapshot(db, operator);
    expect(after.incidents_open).toBe(before.incidents_open);
    expect(after.simulated_open).toBeGreaterThanOrEqual(1);
    await expectAppError(createSimulatedIncident(db, operator, { scenario: "ai-degraded" }, { allowed: false }), "FORBIDDEN");
    expect(buildDiagnosticReport(detail, { appEnv: "test", commit: null }).incident.origin).toBe("simulated");
  });
});
