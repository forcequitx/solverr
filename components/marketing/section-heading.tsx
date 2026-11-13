import type { ReactNode } from "react";
import { Reveal } from "@/components/marketing/reveal";

/** Label chip colors: the usual gray, or the warning yellow of the Demo badge for test-mode pages. */
const LABEL_TONES = {
  default: "border-line bg-surface-2",
  warn: "border-transparent bg-warn-bg text-warn",
};

/** Centered section intro: a small label pill, a large heading and an optional line of text, revealed one after another. `as="h1"` makes it the page heading. */
export function SectionHeading({
  label,
  labelTone = "default",
  title,
  description,
  as: Heading = "h2",
}: {
  label: string;
  labelTone?: keyof typeof LABEL_TONES;
  title: ReactNode;
  description?: string;
  as?: "h1" | "h2";
}) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
      <Reveal>
        <span className={`inline-block rounded-[12px] border px-4 py-2 text-xs font-medium ${LABEL_TONES[labelTone]}`}>{label}</span>
      </Reveal>
      <Reveal delay={0.08}>
        <Heading className="mt-5 text-balance text-[38px] font-medium leading-[1.12] tracking-[-0.04em] sm:text-6xl sm:leading-[1.2]">{title}</Heading>
      </Reveal>
      {description ? (
        <Reveal delay={0.16}>
          <p className="mt-4 max-w-xl text-lg text-muted">{description}</p>
        </Reveal>
      ) : null}
    </div>
  );
}

const SHEEN =
  "animate-text-sheen bg-[linear-gradient(110deg,var(--accent-text)_40%,var(--chart-3)_50%,var(--logo-bottom)_55%,var(--accent-text)_65%)] bg-[length:300%_100%] bg-clip-text text-transparent";

/** The highlighted word or phrase in a landing heading, in the brand blue; `sheen` sends a slow light across it. */
export function Accent({ sheen = false, children }: { sheen?: boolean; children: ReactNode }) {
  return <span className={sheen ? SHEEN : "text-accent-text"}>{children}</span>;
}
