/** Type style of the "Solverr" wordmark beside the mark. */
export const WORDMARK = "font-heading font-extrabold tracking-[-0.035em]";

/** The Bauhaus S: a blue block over a lime block, colored by the logo tokens so it keeps the brand colors when the accent changes. */
export function LogoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="7 7 34 34" className={className} aria-hidden="true">
      <path d="M24 8H38V24H24A8 8 0 0 1 24 8Z" className="fill-logo-top" />
      <path d="M24 24H10V40H24A8 8 0 0 0 24 24Z" className="fill-logo-bottom" />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 text-xl text-fg ${WORDMARK} ${className}`}>
      <LogoMark />
      Solverr
    </span>
  );
}
