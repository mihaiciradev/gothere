export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display font-semibold tracking-[-0.04em] ${className}`} aria-label="gothere">
      gothere<span className="text-lime">.</span>
    </span>
  );
}
