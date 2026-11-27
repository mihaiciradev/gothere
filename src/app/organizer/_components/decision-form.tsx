"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

type Result = { status: "executed" | "rejected" | "failed"; error?: { message: string } };

/**
 * Approve or reject exactly the parameters on screen: the form submits their hash, and the server refuses the
 * decision if the stored request no longer matches it.
 */
export function DecisionForm({ organizationId, requestId, paramsHash, mode = "decide" }: { organizationId: string; requestId: string; paramsHash: string; mode?: "decide" | "execute" }) {
  const router = useRouter();
  const noteId = useId();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<null | "approve" | "reject" | "execute">(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  useEffect(() => () => setPending(null), []);
  const base = `/api/organizer/organizations/${organizationId}/action-requests/${requestId}`;

  async function send(kind: "approve" | "reject" | "execute") {
    setPending(kind);
    setMessage(null);
    const response = await fetch(kind === "execute" ? `${base}/execute` : `${base}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: kind === "execute" ? "{}" : JSON.stringify({ decision: kind, paramsHash, note: note.trim() || undefined }),
    }).catch(() => null);
    const body = response ? ((await response.json().catch(() => ({}))) as { data?: Result; error?: { message?: string } }) : {};
    setPending(null);
    if (!response?.ok || !body.data) {
      setMessage({ tone: "error", text: body.error?.message ?? "The decision was not recorded. Try again." });
      router.refresh();
      return;
    }
    // The request leaves the waiting list once decided, so the outcome is shown by the page itself (from the
    // database record), addressed by `?decided=`.
    const params = new URLSearchParams(window.location.search);
    params.set("decided", requestId);
    router.replace(`${window.location.pathname}?${params.toString()}`, { scroll: true });
  }

  if (mode === "execute") {
    return (
      <button type="button" onClick={() => send("execute")} disabled={pending !== null} className="bg-obsidian px-4 py-2 text-sm text-offwhite disabled:bg-graphite-400">
        {pending ? "Executing…" : "Execute approved action"}
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <label htmlFor={noteId} className="label text-graphite-500">
        Note (optional)
      </label>
      <input
        id={noteId}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        placeholder="e.g. crew and pier confirmed for Sunday"
        className="w-full border border-border bg-bg px-3 py-2 text-sm placeholder:text-graphite-500 focus:border-violet-strong focus:outline-none"
      />
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => send("approve")}
          disabled={pending !== null}
          className="bg-violet-strong px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-obsidian disabled:bg-graphite-400"
        >
          {pending === "approve" ? "Approving…" : "Approve and publish"}
        </button>
        <button
          type="button"
          onClick={() => send("reject")}
          disabled={pending !== null}
          className="border border-border px-4 py-2.5 text-sm transition-colors hover:border-obsidian disabled:text-graphite-400"
        >
          {pending === "reject" ? "Rejecting…" : "Reject"}
        </button>
      </div>
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`text-sm ${message.tone === "error" ? "text-[#b42318]" : "text-[#1f7a52]"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
