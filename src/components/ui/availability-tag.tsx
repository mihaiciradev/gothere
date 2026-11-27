type Status = "available" | "limited" | "sold_out" | "not_on_sale";

const copy: Record<Status, string> = {
  available: "On sale",
  limited: "Last tickets",
  sold_out: "Sold out",
  not_on_sale: "Not on sale",
};

/** Live availability signal. Text carries the meaning; colour only reinforces it. */
export function AvailabilityTag({ status, className = "" }: { status: Status; className?: string }) {
  const tone =
    status === "available"
      ? "text-lime"
      : status === "limited"
        ? "text-warning"
        : "text-graphite-400";
  return (
    <span className={`inline-flex items-center gap-2 label ${tone} ${className}`}>
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${status === "available" || status === "limited" ? "animate-live bg-current" : "bg-graphite-500"}`}
      />
      {copy[status]}
    </span>
  );
}
