"use client";

import { EMPTY_LIST_HEIGHT, PAGER_BUTTON } from "@/components/dashboard/list/list-styles";
import { usePages } from "@/components/dashboard/list/use-pages";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { IconBox, InitialsAvatar } from "@/components/ui/icon-box";
import { formatUsd } from "@/lib/format";
import type { ChainShare } from "@/lib/merchants/stats";

const PAGE_SIZE = 4;
/** Room for a page of four: four 62px rows on phones, two rows of tiles (the empty-list height) from 640px up. */
const LIST_HEIGHT = "min-h-[284px] sm:min-h-[220px]";

function ChainTile({ chain, index }: { chain: ChainShare; index: number }) {
  return (
    <li
      className="flex min-w-0 animate-row-in items-center gap-3 rounded-[16px] border border-line p-3 sm:flex-col sm:items-stretch"
      style={{ animationDelay: `${(index % PAGE_SIZE) * 40}ms` }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <InitialsAvatar text={chain.name} index={index} />
        <div className="min-w-0">
          <p className="truncate text-body font-semibold">{chain.name}</p>
          <p className="truncate text-meta text-muted">
            {chain.payments} {chain.payments === 1 ? "payment" : "payments"}
          </p>
        </div>
      </div>
      <p className="shrink-0 truncate rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium tabular-nums text-muted sm:shrink">
        {formatUsd(chain.revenueUsd)} · {chain.share}%
      </p>
    </li>
  );
}

/** Chains customers paid from in the last 30 days, four per page: tiles in two columns, or one row each on phones. */
export function ChainsCard({ chains }: { chains: ChainShare[] }) {
  const { page, pages, visible, setPage } = usePages(chains, PAGE_SIZE);

  return (
    <Card className="flex min-w-0 flex-col gap-5 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <IconBox name="chain" />
        <div>
          <h2 className="text-meta text-muted">Revenue by customer network</h2>
          <p className="mt-1 font-heading text-3xl font-semibold tracking-tight">
            <AnimatedNumber value={chains.length} suffix={chains.length === 1 ? " chain" : " chains"} />
          </p>
          <p className="text-meta text-muted">Last 30 days</p>
        </div>
      </div>

      {/** A full page's height once there are several chains, so paging never changes the card's size; one chain or none keeps the compact height. */}
      {chains.length === 0 ? (
        <p className={`grid flex-1 place-items-center rounded-[16px] border border-dashed border-line px-6 text-center text-meta text-muted ${EMPTY_LIST_HEIGHT}`}>No paid payments in the last 30 days.</p>
      ) : (
        <ul key={page} className={`grid flex-1 content-start gap-3 sm:grid-cols-2 ${chains.length > 1 ? LIST_HEIGHT : EMPTY_LIST_HEIGHT}`}>
          {visible.map((chain, index) => (
            <ChainTile key={chain.id} chain={chain} index={page * PAGE_SIZE + index} />
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button type="button" className={`${PAGER_BUTTON} justify-center`} disabled={page === 0} onClick={() => setPage(page - 1)}>
          <Icon name="arrowLeft" className="size-4" />
          Previous
        </button>
        <button type="button" className={`${PAGER_BUTTON} justify-center`} disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
          Next
          <Icon name="arrowRight" className="size-4" />
        </button>
      </div>
    </Card>
  );
}
