"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

type Body<T> = { data?: T; error?: { message?: string } };

async function post<T>(url: string, body: unknown = {}) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const json = response ? ((await response.json().catch(() => ({}))) as Body<T>) : {};
  return { ok: !!response?.ok, data: json.data, message: json.error?.message ?? (response ? undefined : "Network problem.") };
}

function usePending() {
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => () => setPending(null), []);
  return [pending, setPending] as const;
}

const button = "border border-graphite-500 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-graphite-100 hover:border-lime hover:text-lime disabled:border-graphite-700 disabled:text-graphite-400";
const primary = "bg-lime px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-obsidian hover:bg-offwhite disabled:bg-graphite-700 disabled:text-graphite-400";

function Message({ text, tone }: { text: string | null; tone: "ok" | "error" }) {
  if (!text) return null;
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`mt-2 text-xs ${tone === "error" ? "text-danger" : "text-graphite-300"}`}>
      {text}
    </p>
  );
}

export function SimulateButtons({ scenarios }: { scenarios: { id: string; label: string }[] }) {
  const router = useRouter();
  const [pending, setPending] = usePending();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {scenarios.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={pending !== null}
            className={button}
            onClick={async () => {
              setPending(s.id);
              setError(null);
              const res = await post<{ incidentId: string }>("/api/control/simulations", { scenario: s.id });
              setPending(null);
              if (res.ok && res.data) router.push(`/control/incidents/${res.data.incidentId}`);
              else setError(res.message ?? "Could not create the simulation.");
            }}
          >
            {pending === s.id ? "Creating…" : `Simulate: ${s.label}`}
          </button>
        ))}
      </div>
      <Message text={error} tone="error" />
    </div>
  );
}

export function StatusControls({ incidentId, status }: { incidentId: string; status: string }) {
  const router = useRouter();
  const noteId = useId();
  const [pending, setPending] = usePending();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (status === "resolved") return <p className="text-sm text-graphite-300">Resolved. A recurrence opens a new incident.</p>;
  const change = async (next: string) => {
    setPending(next);
    setError(null);
    const res = await post(`/api/control/incidents/${incidentId}/status`, { status: next, note: note.trim() || undefined });
    setPending(null);
    if (res.ok) router.refresh();
    else setError(res.message ?? "The status was not changed.");
  };
  return (
    <div className="space-y-3">
      <label htmlFor={noteId} className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-graphite-400">
        Note (required to resolve)
      </label>
      <input id={noteId} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="w-full border border-border bg-bg px-3 py-2 text-sm focus:border-lime focus:outline-none" />
      <div className="flex flex-wrap gap-2">
        {status === "open" && (
          <button type="button" className={button} disabled={pending !== null} onClick={() => change("investigating")}>
            {pending === "investigating" ? "Saving…" : "Acknowledge"}
          </button>
        )}
        {status !== "mitigated" && (
          <button type="button" className={button} disabled={pending !== null} onClick={() => change("mitigated")}>
            {pending === "mitigated" ? "Saving…" : "Mark mitigated"}
          </button>
        )}
        <button type="button" className={primary} disabled={pending !== null} onClick={() => change("resolved")}>
          {pending === "resolved" ? "Saving…" : "Resolve"}
        </button>
      </div>
      <Message text={error} tone="error" />
    </div>
  );
}

type AgentResult = { mode: "ai" | "automation"; packageId: string | null; dispatchRequestId: string | null; notice: string | null };

export function AgentButton({ incidentId }: { incidentId: string }) {
  const router = useRouter();
  const [pending, setPending] = usePending();
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  return (
    <div>
      <button
        type="button"
        className={primary}
        disabled={pending !== null}
        onClick={async () => {
          setPending("agent");
          setMessage(null);
          const res = await post<AgentResult>(`/api/control/incidents/${incidentId}/agent`);
          setPending(null);
          if (res.ok && res.data) {
            const d = res.data;
            setMessage({
              tone: "ok",
              text: `${d.mode === "ai" ? "AI agent" : "Runbook automation"} finished.${d.packageId ? " Investigation package generated (not executed)." : ""}${d.dispatchRequestId ? " External investigation requested: waiting for approval." : ""}${d.notice ? ` ${d.notice}` : ""}`,
            });
            router.refresh();
          } else setMessage({ tone: "error", text: res.message ?? "The agent could not run." });
        }}
      >
        {pending ? "Running agent…" : "Run engineering agent"}
      </button>
      <Message text={message?.text ?? null} tone={message?.tone ?? "ok"} />
    </div>
  );
}

export function ActionButton({ actionId, input, label, done }: { actionId: string; input: Record<string, unknown>; label: string; done: string }) {
  const router = useRouter();
  const [pending, setPending] = usePending();
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  return (
    <div>
      <button
        type="button"
        className={button}
        disabled={pending !== null}
        onClick={async () => {
          setPending(actionId);
          setMessage(null);
          const res = await post<{ status: string }>(`/api/control/actions/${actionId}`, input);
          setPending(null);
          if (res.ok) {
            setMessage({ tone: "ok", text: res.data?.status === "pending_approval" ? "Requested. Waiting for an approval below." : done });
            router.refresh();
          } else setMessage({ tone: "error", text: res.message ?? "The action failed." });
        }}
      >
        {pending ? "Working…" : label}
      </button>
      <Message text={message?.text ?? null} tone={message?.tone ?? "ok"} />
    </div>
  );
}

type Decision = { status: "executed" | "rejected" | "failed"; error?: { message: string } };

export function PlatformDecision({ requestId, paramsHash }: { requestId: string; paramsHash: string }) {
  const router = useRouter();
  const [pending, setPending] = usePending();
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const decide = async (decision: "approve" | "reject") => {
    setPending(decision);
    setMessage(null);
    const res = await post<Decision>(`/api/control/action-requests/${requestId}/decision`, { decision, paramsHash });
    setPending(null);
    if (!res.ok || !res.data) setMessage({ tone: "error", text: res.message ?? "The decision was not recorded." });
    else if (res.data.status === "failed") setMessage({ tone: "error", text: `Approved, but not executed: ${res.data.error?.message ?? "unknown reason"}` });
    else setMessage({ tone: "ok", text: res.data.status === "executed" ? "Approved and executed." : "Rejected. Nothing ran." });
    router.refresh();
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primary} disabled={pending !== null} onClick={() => decide("approve")}>
          {pending === "approve" ? "Approving…" : "Approve"}
        </button>
        <button type="button" className={button} disabled={pending !== null} onClick={() => decide("reject")}>
          {pending === "reject" ? "Rejecting…" : "Reject"}
        </button>
      </div>
      <Message text={message?.text ?? null} tone={message?.tone ?? "ok"} />
    </div>
  );
}
