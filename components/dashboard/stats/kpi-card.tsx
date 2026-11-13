import Link from "next/link";
import type { ReactNode } from "react";
import { AnimatedNumber, type NumberFormat } from "@/components/ui/animated-number";
import { Card } from "@/components/ui/card";
import type { IconName } from "@/components/ui/icon";
import { IconBox, type Tint } from "@/components/ui/icon-box";

/** Dollar values from here on show as $1.23M, since a rolling number cannot wrap and would overflow a half-width card on phones. */
const COMPACT_FROM_USD = 1_000_000;

/** Small stat card: icon, label, big rolling value and a change chip; with `href` the whole card is a link. */
export function KpiCard({ icon, tint, label, value, format, chip, href }: { icon: IconName; tint: Tint; label: string; value: number; format?: NumberFormat; chip?: ReactNode; href?: string }) {
  return (
    <Card className="@container relative flex min-w-0 flex-col p-4 transition-colors has-[a:hover]:border-accent/30 sm:p-5">
      <IconBox name={icon} tint={tint} />
      <p className="mt-4 text-meta text-muted">
        {href ? (
          <Link href={href} className="after:absolute after:inset-0 after:rounded-card focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent">
            {label}
          </Link>
        ) : (
          label
        )}
      </p>
      <div className="mt-auto flex flex-wrap items-end justify-between gap-x-2 gap-y-1 pt-1">
        <AnimatedNumber value={value} format={format === "usd" && value >= COMPACT_FROM_USD ? "usdCompact" : format} className="font-heading text-lg font-semibold tracking-tight @min-[8.5rem]:text-xl @min-[11rem]:text-2xl" />
        {chip}
      </div>
    </Card>
  );
}
