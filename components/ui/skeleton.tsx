/** Placeholder block with a soft shimmer, shown while content loads. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-shimmer rounded-control bg-[linear-gradient(90deg,var(--surface-2)_0%,var(--border)_50%,var(--surface-2)_100%)] bg-[length:200%_100%] ${className}`} />;
}
