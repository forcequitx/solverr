import type { ReactNode } from "react";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon, type IconName } from "@/components/ui/icon";

/** Tone of a stacked card: --c is the icon color, --g its glow, --cb the tint at the top of the front card. */
const DECK_TONES = {
  accent: "[--c:var(--accent-text)] [--g:var(--accent)] [--cb:color-mix(in_srgb,var(--accent)_11%,var(--surface))]",
  success: "[--c:var(--success)] [--g:var(--success)] [--cb:color-mix(in_srgb,var(--success-bg)_75%,var(--surface))]",
  muted: "[--c:var(--muted)] [--g:var(--muted)] [--cb:var(--surface-2)]",
  warn: "[--c:var(--warn)] [--g:var(--warn)] [--cb:var(--warn-bg)]",
  info: "[--c:var(--info)] [--g:var(--info)] [--cb:var(--info-bg)]",
  danger: "[--c:var(--danger)] [--g:var(--danger)] [--cb:var(--danger-bg)]",
};
export type DeckTone = keyof typeof DECK_TONES;

/** Size of the buttons under a stacked card. */
export const DECK_BUTTON = "h-14! rounded-[18px]! text-[16.5px]!";

/** A tinted `front` card, a gray tray with `children` tucked under it, a ghost card below, then `actions`; `alert` announces the front card
    when it appears. At most 460px wide, or as wide as its column with `fullWidth`. */
export function StackedCards({
  tone,
  front,
  align = "center",
  fullWidth = false,
  alert = false,
  actions,
  children,
}: {
  tone: DeckTone;
  front: ReactNode;
  align?: "center" | "start";
  fullWidth?: boolean;
  alert?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className={`@container mx-auto flex w-full flex-col gap-4 ${fullWidth ? "" : "max-w-[460px]"} ${DECK_TONES[tone]}`}>
      <div className="flex flex-col">
        <div
          role={alert ? "alert" : undefined}
          className={`relative z-[3] flex animate-deck-drop flex-col gap-3 rounded-3xl border border-line bg-[linear-gradient(var(--cb),var(--surface)_62%)] px-4 pt-6 pb-5 shadow-[0_22px_44px_-30px_rgb(0_0_0/0.45),0_2px_6px_-3px_rgb(0_0_0/0.1)] @[25rem]:px-[22px] @[25rem]:pt-7 @[25rem]:pb-6 ${
            align === "center" ? "items-center text-center" : ""
          }`}
        >
          {front}
        </div>
        <div className="relative z-[2] mx-2 -mt-[22px] flex animate-deck-slide flex-col gap-3.5 rounded-b-[22px] border border-t-0 border-line bg-surface-2 px-3.5 pt-[34px] pb-4 @[25rem]:mx-3.5 @[25rem]:px-[18px] @[25rem]:pt-9 @[25rem]:pb-[18px]">
          {children}
        </div>
        <span
          aria-hidden="true"
          className="relative z-[1] mx-[22px] -mt-4 h-[26px] animate-deck-slide rounded-b-[18px] border border-t-0 border-line bg-[color-mix(in_srgb,var(--border)_45%,var(--surface-2))] [animation-delay:280ms] @[25rem]:mx-[30px]"
        />
      </div>
      {actions ? <div className="grid animate-rise-in grid-cols-2 gap-2.5 [animation-delay:360ms]">{actions}</div> : null}
    </section>
  );
}

/** A result as stacked cards: round icon, title and `lead` on the front, details in the tray; `titleAs="h1"` for a card that is the whole page. */
export function StackedResult({
  tone,
  icon,
  title,
  titleAs: Title = "h2",
  lead,
  alert = false,
  actions,
  children,
}: {
  tone: DeckTone;
  icon: IconName;
  title: string;
  titleAs?: "h1" | "h2";
  lead?: ReactNode;
  alert?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <StackedCards
      tone={tone}
      alert={alert}
      actions={actions}
      front={
        <>
          <DeckIcon icon={icon} />
          <Title tabIndex={-1} className={`font-heading text-[23px] leading-tight font-bold tracking-[-0.025em] text-balance @[25rem]:text-[26px] ${FOCUS_RING}`}>
            {title}
          </Title>
          {lead}
        </>
      }
    >
      {children}
    </StackedCards>
  );
}

/** The round icon on a stacked card's front, in the card's tone. */
export function DeckIcon({ icon, size = "lg" }: { icon: IconName; size?: "lg" | "sm" }) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full bg-surface text-(--c) shadow-[0_0_0_6px_color-mix(in_srgb,var(--g)_12%,transparent)] ${size === "lg" ? "size-16" : "size-11"}`}
    >
      <Icon name={icon} className={size === "lg" ? "size-7" : "size-5"} />
    </span>
  );
}

/** A white box inside a stacked card's tray. */
export function DeckBox({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl bg-surface px-4 py-3">{children}</div>;
}

/** Label and value lines in a white box inside a stacked card's tray. */
export function DeckDetails({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="rounded-2xl bg-surface px-4 py-2.5">
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between gap-3 border-t border-line py-[7px] text-[14.5px] leading-snug first:border-t-0">
          <dt className="shrink-0 text-muted">{row.label}</dt>
          <dd className="min-w-0 text-right font-semibold [overflow-wrap:anywhere]">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A notice in the checkout as a small stacked card: a tinted card with a round icon and the text, and a tray peeking below. */
export function StackedNotice({ tone, children }: { tone: "warn" | "info"; children: ReactNode }) {
  return (
    <div role="status" className={`flex flex-col ${DECK_TONES[tone]}`}>
      <div className="relative z-[2] flex animate-deck-drop items-start gap-3 rounded-[18px] border border-line bg-[linear-gradient(var(--cb),var(--surface)_80%)] px-3.5 py-3 shadow-[0_14px_30px_-24px_rgb(0_0_0/0.45)]">
        <span aria-hidden="true" className="grid size-[30px] shrink-0 place-items-center rounded-full bg-surface text-(--c) shadow-[0_0_0_4px_color-mix(in_srgb,var(--g)_12%,transparent)]">
          <Icon name={tone === "info" ? "info" : "alert"} className="size-[15px]" />
        </span>
        <p className="min-w-0 pt-1 text-[14.5px] leading-snug font-semibold break-words">{children}</p>
      </div>
      <span aria-hidden="true" className="relative z-[1] mx-3.5 -mt-2.5 h-[18px] animate-deck-slide rounded-b-[14px] border border-t-0 border-line bg-surface-2" />
    </div>
  );
}
