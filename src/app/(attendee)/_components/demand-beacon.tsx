"use client";

import { useEffect } from "react";

/**
 * Reports unmet demand after the page is actually shown (never on prefetch): a search that found nothing, or
 * sold-out items on screen. Fire-and-forget; the server deduplicates per person and day.
 */
export function DemandBeacon(props: { kind: "search"; query: string } | { kind: "sold_out"; inventoryItemIds: string[] }) {
  const key = props.kind === "search" ? props.query : props.inventoryItemIds.join(",");
  useEffect(() => {
    if (!key) return;
    const [url, body] =
      props.kind === "search"
        ? ["/api/demand/searches", { query: props.query }]
        : ["/api/demand/views", { inventoryItemIds: props.inventoryItemIds.slice(0, 12) }];
    void fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      // Drain the response so the request completes (an unread body keeps it open in some browsers).
      .then((response) => response.text())
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}
