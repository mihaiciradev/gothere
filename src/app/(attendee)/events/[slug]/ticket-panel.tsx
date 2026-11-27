"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { WaitlistButton } from "./waitlist-button";

export type PanelItem = {
  id: string;
  name: string;
  description: string | null;
  detail: string | null;
  priceLabel: string;
  priceMinor: number;
  currency: string;
  maxPerOrder: number;
  available: number;
  onSale: boolean;
  soldOut: boolean;
};

export type PanelGroup = { label: string; items: PanelItem[] };

type ApiError = { error?: { code?: string; message?: string; details?: Record<string, unknown> } };

/** Selection encoded for the sign-in round trip: `id:qty,id:qty`. Re-validated by the event page. */
export function encodeSelection(quantities: Record<string, number>): string {
  return Object.entries(quantities)
    .filter(([, q]) => q > 0)
    .map(([id, q]) => `${id}:${q}`)
    .join(",");
}

function formatTotal(amountMinor: number, currency: string) {
  const value = new Intl.NumberFormat("en-IE", { style: "currency", currency, minimumFractionDigits: 2 }).format(amountMinor / 100);
  return amountMinor % 100 === 0 ? value.replace(/[.,]00(?=\D*$)/, "") : value;
}

/**
 * Ticket selection and reservation. The total shown here is a preview; the reservation endpoint reads
 * prices and availability from the database and its response is what the checkout shows.
 */
export function TicketPanel({
  eventId,
  eventSlug,
  groups,
  initialSelection,
  waitlisted = [],
}: {
  eventId: string;
  eventSlug: string;
  groups: PanelGroup[];
  /** Sold-out items the signed-in attendee already asked to be notified about. */
  waitlisted?: string[];
  /** Selection carried through sign-in, already validated against live availability on the server. */
  initialSelection: Record<string, number>;
}) {
  const router = useRouter();
  const headingId = useId();
  const [quantities, setQuantities] = useState<Record<string, number>>(initialSelection);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState<string | null>(null);

  // Next keeps visited routes alive in hidden <Activity> boundaries. When this page is hidden (we navigated
  // to checkout or sign-in), reset the in-flight state so coming back never shows a stuck button.
  useEffect(
    () => () => {
      setSubmitting(false);
      setRequestKey(null);
    },
    [],
  );

  const items = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const lines = items.filter((i) => (quantities[i.id] ?? 0) > 0).map((i) => ({ item: i, quantity: quantities[i.id]! }));
  const count = lines.reduce((sum, l) => sum + l.quantity, 0);
  const currency = lines[0]?.item.currency ?? items[0]?.currency ?? "EUR";
  const total = lines.reduce((sum, l) => sum + l.item.priceMinor * l.quantity, 0);

  const change = (item: PanelItem, delta: number) => {
    setError(null);
    setRequestKey(null);
    setQuantities((prev) => {
      const limit = Math.min(item.maxPerOrder, item.available);
      const next = Math.max(0, Math.min(limit, (prev[item.id] ?? 0) + delta));
      return { ...prev, [item.id]: next };
    });
  };

  async function reserve() {
    if (count === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    // One key per distinct submission: a network retry of the same selection cannot create a second hold.
    const key = requestKey ?? crypto.randomUUID();
    setRequestKey(key);
    try {
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({ eventId, items: lines.map((l) => ({ inventoryItemId: l.item.id, quantity: l.quantity })) }),
      });
      if (response.status === 401) {
        setSubmitting(false);
        setRequestKey(null);
        const back = `/events/${eventSlug}?select=${encodeURIComponent(encodeSelection(quantities))}#tickets`;
        router.push(`/sign-in?next=${encodeURIComponent(back)}`);
        return;
      }
      const body = (await response.json()) as ApiError & { data?: { id: string } };
      if (response.ok && body.data) {
        router.push(`/checkout/${body.data.id}`);
        return;
      }
      setSubmitting(false);
      setRequestKey(null);
      const reason = body.error?.details?.reason;
      if (reason === "insufficient_inventory") {
        const left = Number(body.error?.details?.available ?? 0);
        setError(left > 0 ? `Only ${left} left for one of your choices. Adjust and try again.` : "One of your choices just sold out.");
        router.refresh();
      } else if (reason === "active_reservation_limit") {
        setError("You already have three tickets on hold. Complete or release one of them first.");
      } else if (response.status === 429) {
        setError("Too many attempts. Wait a moment and try again.");
      } else {
        setError(body.error?.message ?? "We couldn’t reserve these tickets. Please try again.");
        if (response.status === 412) router.refresh();
      }
    } catch {
      setSubmitting(false);
      setError("Network problem. Your selection is kept — try again.");
    }
  }

  return (
    <section aria-labelledby={headingId} id="tickets" className="scroll-mt-24 border hairline bg-graphite-900/60">
      <div className="border-b hairline px-5 py-4 md:px-6">
        <h2 id={headingId} className="font-display text-2xl font-semibold tracking-tight">
          Tickets
        </h2>
        <p className="mt-1 label text-graphite-400">Prices are final · no booking fee</p>
      </div>

      {groups.map((group) =>
        group.items.length === 0 ? null : (
          <div key={group.label}>
            <p className="label border-b hairline px-5 pt-5 pb-3 text-graphite-400 md:px-6">{group.label}</p>
            <ul>
              {group.items.map((item) => {
                const quantity = quantities[item.id] ?? 0;
                const limit = Math.min(item.maxPerOrder, item.available);
                const unavailable = !item.onSale || item.soldOut;
                return (
                  <li key={item.id} className="border-b hairline px-5 py-4 md:px-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className={`font-medium ${unavailable ? "text-graphite-400" : "text-offwhite"}`}>{item.name}</p>
                        {item.detail && <p className="mt-0.5 label text-graphite-400">{item.detail}</p>}
                        {item.description && <p className="mt-1 text-sm text-graphite-300">{item.description}</p>}
                      </div>
                      <p className={`tabular shrink-0 ${unavailable ? "text-graphite-400 line-through" : ""}`}>{item.priceLabel}</p>
                    </div>

                    <div className="mt-3 flex min-h-10 items-center justify-between gap-4">
                      {item.soldOut ? (
                        <>
                          <p className="text-sm text-graphite-300">
                            <span className="label text-graphite-400">Sold out</span>
                            <span className="mt-1 block text-xs text-graphite-400">Demand for sold-out sessions helps organisers add more.</span>
                          </p>
                          <WaitlistButton inventoryItemId={item.id} itemName={item.name} eventSlug={eventSlug} initiallyJoined={waitlisted.includes(item.id)} />
                        </>
                      ) : !item.onSale ? (
                        <span className="label text-graphite-400">Not on sale</span>
                      ) : (
                        <span className={`label ${item.available <= 10 ? "text-warning" : "text-graphite-400"}`}>
                          {item.available <= 10 ? `${item.available} left` : `Max ${item.maxPerOrder} per order`}
                        </span>
                      )}
                      {!unavailable && (
                        <div className="flex items-center border hairline" role="group" aria-label={`Quantity for ${item.name}`}>
                          <button
                            type="button"
                            onClick={() => change(item, -1)}
                            disabled={quantity === 0}
                            aria-label={`Remove one ${item.name}`}
                            className="grid size-10 place-items-center text-lg disabled:text-graphite-600"
                          >
                            −
                          </button>
                          <output aria-live="polite" className="tabular w-8 text-center font-mono">
                            {quantity}
                          </output>
                          <button
                            type="button"
                            onClick={() => change(item, 1)}
                            disabled={quantity >= limit}
                            aria-label={`Add one ${item.name}`}
                            className="grid size-10 place-items-center text-lg disabled:text-graphite-600"
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ),
      )}

      <div className="px-5 py-5 md:px-6">
        <div className="flex items-baseline justify-between">
          <span className="label text-graphite-400">
            {count === 0 ? "Choose tickets" : `${count} ${count === 1 ? "ticket" : "tickets"} · total`}
          </span>
          <span className="tabular font-display text-3xl font-semibold tracking-tight">{formatTotal(total, currency)}</span>
        </div>
        <AnimatePresence>
          {error && (
            <motion.p
              role="alert"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-4 border-l-2 border-danger pl-3 text-sm text-offwhite"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>
        <button
          type="button"
          onClick={reserve}
          disabled={count === 0 || submitting}
          className="mt-5 flex w-full items-center justify-between bg-lime px-5 py-4 font-medium text-obsidian transition-colors hover:bg-offwhite disabled:cursor-not-allowed disabled:bg-graphite-700 disabled:text-graphite-400"
        >
          <span>{submitting ? "Holding your tickets…" : "Reserve"}</span>
          <span aria-hidden>→</span>
        </button>
        <p className="mt-3 text-xs text-graphite-400">
          Tickets are held for 10 minutes while you pay. Payments in this prototype are simulated.{" "}
          <Link href="/tickets" className="underline underline-offset-2 hover:text-offwhite">
            Your tickets
          </Link>
        </p>
      </div>

      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t hairline bg-obsidian/95 px-5 py-3 backdrop-blur md:hidden">
          <button
            type="button"
            onClick={reserve}
            disabled={submitting}
            className="flex w-full items-center justify-between bg-lime px-5 py-4 font-medium text-obsidian"
          >
            <span>{submitting ? "Holding…" : `Reserve ${count}`}</span>
            <span className="tabular">{formatTotal(total, currency)}</span>
          </button>
        </div>
      )}
    </section>
  );
}
