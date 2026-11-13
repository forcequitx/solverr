import { ChainBadge } from "@/components/ui/chain-badge";
import { CHAINS } from "@/lib/chains/registry";

/** Endless row of the networks customers can pay from; the second, hidden copy fills the gap so the loop has no jump. */
export function ChainMarquee() {
  return (
    <div className="overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
      <div className="flex w-max animate-marquee hover:[animation-play-state:paused] motion-reduce:[animation-play-state:paused]">
        {[0, 1].map((copy) => (
          <ul key={copy} aria-hidden={copy === 1 ? true : undefined} className="flex shrink-0 gap-3 pr-3">
            {CHAINS.map((chain) => (
              <li key={chain.id} className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface py-1.5 pl-1.5 pr-3.5 text-sm font-medium">
                <ChainBadge chain={chain} className="size-6 text-[11px]" />
                {chain.name}
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
