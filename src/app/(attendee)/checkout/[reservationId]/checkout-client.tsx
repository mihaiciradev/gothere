"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type CheckoutPayment = {
  id: string;
  status: "initiated" | "pending" | "succeeded" | "failed" | "unknown";
  disposition: "none" | "accepted" | "refund_required" | "refunded";
  amountMinor: number;
  currency: string;
  failureCode: string | null;
  createdAt: string;
};

export type CheckoutState = {
  id: string;
  status: "active" | "converted" | "expired" | "released";
  expiresAt: string;
  /** From the database clock; the client counts down from this, never from its own clock. */
  secondsRemaining: number;
  totalMinor: number;
  currency: string;
  items: { inventoryItemId: string; name: string; quantity: number; unitPriceMinor: number }[];
  payments: CheckoutPayment[];
  orderId: string | null;
};

const scenarios = [
  { value: "success", label: "Approve", hint: "Confirmed immediately" },
  { value: "decline", label: "Decline", hint: "Card declined; you can retry" },
  { value: "delayed_success", label: "Delayed", hint: "Confirmation arrives ~20 s later" },
  { value: "duplicate_notification", label: "Duplicate webhooks", hint: "Provider notifies twice" },
  { value: "out_of_order", label: "Out of order", hint: "A stale update arrives late" },
  { value: "timeout", label: "Timeout", hint: "Outcome unknown; reconciled with the provider" },
  { value: "unavailable", label: "Provider down", hint: "Nothing charged; retry" },
] as const;

const failureCopy: Record<string, string> = {
  card_declined: "The card was declined.",
  provider_unavailable: "The payment provider was unavailable. Nothing was charged.",
  not_received_by_provider: "The provider never received the payment. Nothing was charged.",
};

function money(amountMinor: number, currency: string) {
  const v = new Intl.NumberFormat("en-IE", { style: "currency", currency, minimumFractionDigits: 2 }).format(amountMinor / 100);
  return amountMinor % 100 === 0 ? v.replace(/[.,]00(?=\D*$)/, "") : v;
}

type Phase = "ready" | "processing" | "awaiting" | "failed" | "confirmed" | "closed";

function derivePhase(state: CheckoutState): Phase {
  if (state.status === "converted") return "confirmed";
  if (state.status !== "active") return "closed";
  const latest = state.payments.at(-1);
  if (latest && ["initiated", "pending", "unknown"].includes(latest.status)) return "awaiting";
  if (latest?.status === "failed") return "failed";
  return "ready";
}

export function CheckoutClient({
  initial,
  scenariosEnabled,
  event,
}: {
  initial: CheckoutState;
  scenariosEnabled: boolean;
  event: { title: string; slug: string; when: string; venue: string };
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<string>("success");
  const payKey = useRef<string | null>(null);
  const expiryChecked = useRef(false);
  // Milliseconds left, counted down from the server's figure. Informational only.
  const [remaining, setRemaining] = useState(initial.secondsRemaining * 1000);

  const phase: Phase = submitting ? "processing" : derivePhase(state);
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const refunds = state.payments.filter((p) => p.disposition === "refund_required" || p.disposition === "refunded");

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/reservations/${state.id}`, { cache: "no-store" });
    if (!response.ok) return;
    const { data } = (await response.json()) as { data: CheckoutState & { createdAt: string } };
    setState({
      id: data.id,
      status: data.status,
      expiresAt: data.expiresAt,
      secondsRemaining: data.secondsRemaining,
      totalMinor: data.totalMinor,
      currency: data.currency,
      items: data.items,
      payments: data.payments,
      orderId: data.orderId,
    });
  }, [state.id]);

  // Informational countdown; the server decides validity at payment time. At zero we ask the server once,
  // which expires the hold if it really is over.
  useEffect(() => {
    if (state.status !== "active") return;
    const started = performance.now();
    const base = state.secondsRemaining * 1000;
    const timer = setInterval(() => {
      const left = Math.max(0, base - (performance.now() - started));
      setRemaining(left);
      if (left === 0 && !expiryChecked.current) {
        expiryChecked.current = true;
        void refresh();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [state.status, state.secondsRemaining, refresh]);

  // Poll while the provider is deciding (polling also advances due background jobs on the server).
  useEffect(() => {
    if (phase !== "awaiting") return;
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [phase, refresh]);

  async function pay() {
    setSubmitting(true);
    setError(null);
    payKey.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/reservations/${state.id}/payments`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": payKey.current },
        body: JSON.stringify(scenariosEnabled ? { scenario } : {}),
      });
      payKey.current = null; // the server answered: the next click is a new attempt
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string; details?: { reason?: string } } };
        const reason = body.error?.details?.reason;
        if (reason === "already_paid" || reason === "reservation_expired" || reason === "reservation_closed") {
          await refresh();
        } else {
          setError(body.error?.message ?? "The payment could not be started.");
        }
      }
      await refresh();
      if (response.ok) router.refresh();
    } catch {
      // Keep the same key: retrying cannot start a second payment for this click.
      setError("Network problem. Try again — you won’t be charged twice.");
    } finally {
      setSubmitting(false);
    }
  }

  async function release() {
    setSubmitting(true);
    await fetch(`/api/reservations/${state.id}`, { method: "DELETE" });
    router.push(`/events/${event.slug}`);
  }

  const summary = useMemo(
    () => (
      <div className="border hairline">
        <div className="border-b hairline px-5 py-4">
          <p className="label text-graphite-400">Your order</p>
          <p className="mt-2 font-display text-2xl font-semibold tracking-tight">{event.title}</p>
          <p className="mt-1 text-sm text-graphite-300">
            {event.when} · {event.venue}
          </p>
        </div>
        <ul>
          {state.items.map((item) => (
            <li key={item.inventoryItemId} className="flex items-baseline justify-between gap-4 border-b hairline px-5 py-3 text-sm">
              <span>
                <span className="tabular text-graphite-400">{item.quantity} ×</span> {item.name}
              </span>
              <span className="tabular">{money(item.unitPriceMinor * item.quantity, state.currency)}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-baseline justify-between px-5 py-4">
          <span className="label text-graphite-400">Total · confirmed by gothere</span>
          <span className="tabular font-display text-3xl font-semibold tracking-tight">{money(state.totalMinor, state.currency)}</span>
        </div>
      </div>
    ),
    [event, state.items, state.currency, state.totalMinor],
  );

  return (
    <div className="grid gap-10 md:grid-cols-12">
      <div className="order-2 min-h-[34rem] md:order-1 md:col-span-7">
        <AnimatePresence mode="wait">
          <motion.section
            key={phase}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            aria-live="polite"
          >
            {phase === "confirmed" ? (
              <div>
                <p className="flex items-center gap-3 label text-lime">
                  <span aria-hidden className="grid size-6 place-items-center bg-lime text-obsidian">✓</span>
                  Payment accepted
                </p>
                <h1 className="mt-5 font-display text-display-lg font-semibold">You’re going.</h1>
                <p className="mt-4 max-w-lg text-lg text-graphite-300">
                  Your tickets are issued and waiting in your wallet. Each one has its own code.
                </p>
                <Link href="/tickets" className="mt-8 inline-flex items-center gap-6 bg-lime px-6 py-4 font-medium text-obsidian hover:bg-offwhite">
                  View my tickets <span aria-hidden>→</span>
                </Link>
              </div>
            ) : phase === "closed" ? (
              <div>
                <p className="label text-graphite-400">{state.status === "released" ? "Hold released" : "Hold expired"}</p>
                <h1 className="mt-5 font-display text-display-lg font-semibold">
                  {state.status === "released" ? "Tickets returned." : "Time ran out."}
                </h1>
                <p className="mt-4 max-w-lg text-lg text-graphite-300">
                  The tickets went back on sale{state.status === "expired" ? " when the 10-minute hold ended" : ""}. No order was created.
                </p>
                <Link href={`/events/${event.slug}`} className="mt-8 inline-flex items-center gap-6 bg-offwhite px-6 py-4 font-medium text-obsidian hover:bg-lime">
                  Back to {event.title} <span aria-hidden>→</span>
                </Link>
              </div>
            ) : phase === "awaiting" || phase === "processing" ? (
              <div>
                <p className="flex items-center gap-3 label text-lime">
                  <span aria-hidden className="size-2 animate-live bg-lime" />
                  {phase === "processing" ? "Contacting the payment provider" : "Waiting for confirmation"}
                </p>
                <h1 className="mt-5 font-display text-display-lg font-semibold">Confirming your payment.</h1>
                <p className="mt-4 max-w-lg text-lg text-graphite-300">
                  {state.payments.at(-1)?.status === "unknown"
                    ? "The provider didn’t answer in time. We’re checking directly with them — you won’t be charged twice."
                    : "This page updates on its own. It’s safe to refresh or come back later."}
                </p>
              </div>
            ) : (
              <div>
                <p className="label text-graphite-400">Checkout</p>
                <h1 className="mt-5 font-display text-display-lg font-semibold">
                  {phase === "failed" ? "Payment didn’t go through." : "Almost there."}
                </h1>
                {phase === "failed" && (
                  <p role="alert" className="mt-4 max-w-lg border-l-2 border-danger pl-4 text-lg text-offwhite">
                    {failureCopy[state.payments.at(-1)?.failureCode ?? ""] ?? "The payment failed."} Your tickets are still held — try again.
                  </p>
                )}

                <div className="mt-8 border border-dashed border-violet/50 px-5 py-4">
                  <p className="label text-violet-soft">Simulated payment</p>
                  <p className="mt-2 text-sm text-graphite-300">
                    This prototype uses a payment simulator. No card is needed and no money moves.
                  </p>
                </div>

                {error && (
                  <p role="alert" className="mt-6 border-l-2 border-danger pl-3 text-sm">
                    {error}
                  </p>
                )}

                <button
                  type="button"
                  onClick={pay}
                  disabled={submitting || remaining === 0}
                  className="mt-6 flex w-full items-center justify-between bg-lime px-6 py-5 text-lg font-medium text-obsidian transition-colors hover:bg-offwhite disabled:bg-graphite-700 disabled:text-graphite-400"
                >
                  <span>{phase === "failed" ? "Try again" : "Pay"} {money(state.totalMinor, state.currency)}</span>
                  <span className="label">Simulated →</span>
                </button>
                <button type="button" onClick={release} disabled={submitting} className="mt-4 label text-graphite-400 hover:text-offwhite">
                  Release my tickets
                </button>

                {scenariosEnabled && (
                  <details className="group mt-10 border-t hairline pt-5">
                    <summary className="flex cursor-pointer list-none items-center justify-between label text-graphite-400 hover:text-offwhite">
                      <span>{`Simulator outcome · demo control — ${scenarios.find((s) => s.value === scenario)?.label ?? ""}`}</span>
                      <span aria-hidden className="transition-transform group-open:rotate-45">+</span>
                    </summary>
                  <fieldset className="mt-4">
                    <legend className="sr-only">Simulator outcome</legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {scenarios.map((s) => (
                        <label
                          key={s.value}
                          className={`cursor-pointer border px-4 py-3 transition-colors ${
                            scenario === s.value ? "border-lime" : "hairline hover:border-graphite-500"
                          }`}
                        >
                          <input
                            type="radio"
                            name="scenario"
                            value={s.value}
                            checked={scenario === s.value}
                            onChange={() => setScenario(s.value)}
                            className="sr-only"
                          />
                          <span className="block text-sm font-medium">{s.label}</span>
                          <span className="block text-xs text-graphite-400">{s.hint}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  </details>
                )}
              </div>
            )}
          </motion.section>
        </AnimatePresence>

        {refunds.length > 0 && (
          <div role="status" className="mt-10 border-l-2 border-warning pl-4 text-sm text-graphite-300">
            <p className="label text-warning">Refund · simulated</p>
            <p className="mt-2">
              {refunds.length === 1 ? "A payment" : `${refunds.length} payments`} arrived after{" "}
              {state.status === "converted" ? "your order was already confirmed" : "your hold ended"} and{" "}
              {refunds.every((r) => r.disposition === "refunded") ? "has been refunded" : "is being refunded"}. No tickets were issued for it.
            </p>
          </div>
        )}
      </div>

      <aside className="order-1 md:order-2 md:col-span-5">
        <div className="md:sticky md:top-24 space-y-4">
          {state.status === "active" && (
            <div className={`flex items-baseline justify-between border px-5 py-4 ${minutes < 2 ? "border-warning" : "hairline"}`}>
              <span className="label text-graphite-400">Tickets held for</span>
              <span className={`tabular font-mono text-3xl ${minutes < 2 ? "text-warning" : "text-offwhite"}`} aria-label={`${minutes} minutes ${seconds} seconds remaining`}>
                {remaining === 0 ? "0:00" : `${minutes}:${String(seconds).padStart(2, "0")}`}
              </span>
            </div>
          )}
          {summary}
        </div>
      </aside>
    </div>
  );
}
