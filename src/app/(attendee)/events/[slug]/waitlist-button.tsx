"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** "Notify me" for a sold-out item. Signed-out attendees go to sign-in and come back to the tickets panel. */
export function WaitlistButton({ inventoryItemId, itemName, eventSlug, initiallyJoined }: { inventoryItemId: string; itemName: string; eventSlug: string; initiallyJoined: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "joining" | "joined" | "error">(initiallyJoined ? "joined" : "idle");
  useEffect(() => () => setState((s) => (s === "joining" ? "idle" : s)), []);

  async function join() {
    setState("joining");
    try {
      const response = await fetch("/api/demand/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inventoryItemId }),
      });
      if (response.status === 401) {
        setState("idle");
        router.push(`/sign-in?next=${encodeURIComponent(`/events/${eventSlug}#tickets`)}`);
        return;
      }
      setState(response.ok ? "joined" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "joined") {
    return (
      <p className="label text-lime" role="status">
        You’re on the list
      </p>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={join}
        disabled={state === "joining"}
        aria-label={`Notify me if ${itemName} gets more places`}
        className="label border border-graphite-600 px-3 py-2 text-offwhite transition-colors hover:border-lime hover:text-lime disabled:text-graphite-400"
      >
        {state === "joining" ? "Adding…" : "Notify me"}
      </button>
      {state === "error" && <span className="text-xs text-warning">Couldn’t add you. Try again.</span>}
    </div>
  );
}
