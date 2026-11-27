"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type ApiBody<T> = { data?: T; error?: { message?: string } };

async function post<T>(url: string, body: unknown = {}): Promise<{ ok: boolean; data?: T; message?: string }> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await response.json().catch(() => ({}))) as ApiBody<T>;
  return { ok: response.ok, data: json.data, message: json.error?.message };
}

function usePending() {
  const [pending, setPending] = useState(false);
  useEffect(() => () => setPending(false), []);
  return [pending, setPending] as const;
}

/** Runs the deterministic demand analysis (`demand.analyze`, invoked by a human). */
export function RunAnalysisButton({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [pending, setPending] = usePending();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-2 md:items-end">
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setMessage(null);
          const result = await post<{ output: { sessionsAnalyzed: number; recommendations: unknown[] } }>(`/api/organizer/organizations/${organizationId}/analysis`);
          setPending(false);
          if (result.ok && result.data) {
            const n = result.data.output.sessionsAnalyzed;
            setMessage(`${n} ${n === 1 ? "session" : "sessions"} analysed.`);
            router.refresh();
          } else setMessage(result.message ?? "The analysis failed. Try again.");
        }}
        className="bg-violet-strong px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-obsidian disabled:bg-graphite-400"
      >
        {pending ? "Analysing…" : "Run demand analysis"}
      </button>
      {message && (
        <p role="status" className="text-xs text-graphite-500">
          {message}
        </p>
      )}
    </div>
  );
}

type Delegation = { mode: "ai" | "automation"; summary: string; approvalRequestId: string | null; notice: string | null };

/** Delegates a recommendation to the agent: private draft + publication request, which waits for approval. */
export function RecommendationActions({ organizationId, recommendationId, canWrite, approvalsHref }: { organizationId: string; recommendationId: string; canWrite: boolean; approvalsHref: string }) {
  const router = useRouter();
  const [pending, setPending] = usePending();
  const [result, setResult] = useState<Delegation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/organizer/organizations/${organizationId}/recommendations/${recommendationId}`;

  if (!canWrite) return <p className="text-xs text-graphite-500">Your role can review this but not act on it.</p>;
  if (result) {
    return (
      <div role="status" className="border-l-2 border-violet-strong pl-4 text-sm">
        <p className="label text-violet-strong">{result.mode === "ai" ? "AI agent" : "Rules automation"}</p>
        <p className="mt-1">{result.summary}</p>
        {result.notice && <p className="mt-1 text-xs text-graphite-500">{result.notice}</p>}
        {result.approvalRequestId && (
          <Link href={approvalsHref} className="mt-2 inline-block text-sm font-medium text-violet-strong hover:underline">
            Review in approvals →
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const res = await post<Delegation>(`${base}/delegate`);
          setPending(false);
          if (res.ok && res.data) {
            setResult(res.data);
            router.refresh();
          } else setError(res.message ?? "The agent could not prepare this.");
        }}
        className="bg-obsidian px-4 py-2.5 text-sm font-medium text-offwhite transition-colors hover:bg-violet-strong disabled:bg-graphite-400"
      >
        {pending ? "Preparing draft…" : "Let the agent prepare it"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const res = await post(`${base}/dismiss`);
          setPending(false);
          if (res.ok) router.refresh();
          else setError(res.message ?? "Could not dismiss.");
        }}
        className="px-3 py-2.5 text-sm text-graphite-500 hover:text-obsidian"
      >
        Dismiss
      </button>
      <p className="w-full text-xs text-graphite-500">Creates a private draft and asks for publication. Nothing goes on sale until an approver accepts it.</p>
      {error && (
        <p role="alert" className="w-full text-sm text-[#b42318]">
          {error}
        </p>
      )}
    </div>
  );
}
