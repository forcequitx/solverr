import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import type { IconName } from "@/components/ui/icon";
import { IconBox, type Tint } from "@/components/ui/icon-box";

/** Small card with one key fact of a detail page: icon, label, value and an optional line below it. */
export function FactCard({ icon, tint, label, value, sub }: { icon: IconName; tint: Tint; label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <Card className="@container flex min-w-0 flex-col p-4 sm:p-5">
      <IconBox name={icon} tint={tint} />
      <p className="mt-4 text-meta text-muted">{label}</p>
      <div className="mt-auto min-w-0 pt-1">
        {/** Sized by the card's width, and wraps rather than cutting off, so "12.345678 USDC" stays readable in a half-width card on a phone. */}
        <div className="text-lg font-semibold tracking-tight [overflow-wrap:anywhere] @min-[8.5rem]:text-xl @min-[11rem]:text-2xl">{value}</div>
        {sub ? <div className="mt-0.5 line-clamp-2 text-meta text-muted">{sub}</div> : null}
      </div>
    </Card>
  );
}
