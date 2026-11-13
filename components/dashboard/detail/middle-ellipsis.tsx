const TAIL = 6;

/** Long ID or address that, when it does not fit, is cut in the middle so its start and its last characters stay readable. */
export function MiddleEllipsis({ value, className = "" }: { value: string; className?: string }) {
  if (value.length <= TAIL * 2) {
    return (
      <span className={`min-w-0 truncate ${className}`} title={value}>
        {value}
      </span>
    );
  }
  return (
    <span className={`flex min-w-0 whitespace-nowrap ${className}`} title={value}>
      <span className="min-w-0 truncate">{value.slice(0, -TAIL)}</span>
      <span className="shrink-0">{value.slice(-TAIL)}</span>
    </span>
  );
}
