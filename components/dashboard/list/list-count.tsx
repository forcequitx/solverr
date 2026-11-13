import { AnimatedNumber } from "@/components/ui/animated-number";

/** A list's count line, such as "12 payments"; once `loaded` reaches `limit`, the page holds only the newest rows, and the line says so. */
export function ListCount({ count, one, many, loaded, limit }: { count: number; one: string; many: string; loaded: number; limit?: number }) {
  return (
    <p className="text-meta text-muted" aria-live="polite">
      <AnimatedNumber value={count} suffix={count === 1 ? ` ${one}` : ` ${many}`} />
      {limit !== undefined && loaded >= limit ? ` among the newest ${limit}` : null}
    </p>
  );
}
