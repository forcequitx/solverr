import type { ReactNode } from "react";

/** Accent band with one card overlapping its bottom edge (customer pages and setup); `footer` sits at the screen bottom, or below a taller card.
    Sizes follow the container, so the embedded checkout (480px wide) gets the phone layout. */
export function BandLayout({ band, footer, wide = false, children }: { band: ReactNode; footer: ReactNode; wide?: boolean; children: ReactNode }) {
  /** On wide screens the card can widen into a landscape rectangle; the footer keeps the same width so their edges line up. */
  const width = wide ? "@5xl:max-w-[1040px]" : "";
  return (
    <div className="@container flex min-h-dvh flex-1 flex-col bg-bg">
      <header className="relative overflow-hidden bg-accent px-4 pt-6 pb-[92px] text-accent-ink @xl:px-6 @xl:pt-10 @xl:pb-[120px]">
        {/** Faint enough that white text over them keeps 4.5:1 (WCAG AA) against the band. */}
        <span aria-hidden="true" className="pointer-events-none absolute -top-[230px] -right-[90px] size-[440px] animate-drift-in rounded-full bg-accent-ink/5" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-[190px] -left-[80px] size-[320px] animate-drift-in rounded-full bg-accent-ink/4 [animation-delay:100ms]" />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-[120px] -left-[60px] size-[200px] animate-drift-in rounded-full border border-accent-ink/16 [animation-delay:200ms] @xl:top-[34px] @xl:left-[14%]"
        />
        <div className="relative z-[1] mx-auto flex max-w-[640px] flex-col items-center text-center">{band}</div>
      </header>
      <main className={`relative z-[2] mx-auto -mt-[68px] flex w-[calc(100%-24px)] max-w-[640px] animate-card-up flex-col gap-3 rounded-2xl border border-line bg-surface p-4 @xl:-mt-[84px] @xl:w-[calc(100%-48px)] @xl:gap-3.5 @xl:p-[26px] ${width}`}>
        {children}
      </main>
      <div className={`mx-auto mt-auto w-[calc(100%-32px)] max-w-[640px] animate-rise-in pt-5 pb-5 [animation-delay:600ms] @xl:w-[calc(100%-48px)] @xl:pb-6 ${width}`}>{footer}</div>
    </div>
  );
}
