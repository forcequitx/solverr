"use client";

import * as m from "motion/react-m";
import { ChainBadge } from "@/components/ui/chain-badge";
import { CoinChainIcon } from "@/components/ui/coin-chain-icon";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { getChain } from "@/lib/chains/registry";
import { amountGroups } from "@/lib/format";

/** Payment step headline: the amount to send (approximate until an address exists, then exact; left out with no estimate), the coin
    and network with "Change coin", and an "on this network only" note once the address is shown. */
export function PayHero({
  label,
  amount,
  approximate,
  symbol,
  blockchain,
  onChain,
  networkNote,
  changeLabel,
  onChange,
}: {
  label: string;
  amount: string | null;
  approximate: boolean;
  symbol: string;
  blockchain: string;
  /** The coin's network, such as "on Base". */
  onChain: string;
  /** "on Base only", shown next to the exact amount while the customer sends manually. */
  networkNote: string | null;
  changeLabel: string;
  /** Omitted once a payment was sent or while a wallet request waits, so the coin cannot change then. */
  onChange?: () => void;
}) {
  const chain = getChain(blockchain);
  return (
    <div className="flex w-full flex-col items-center gap-2.5 bg-[radial-gradient(50%_70%_at_50%_45%,color-mix(in_srgb,var(--accent)_10%,transparent),transparent_75%)] pt-3.5 pb-1.5 text-center">
      <h2 tabIndex={-1} className={`font-heading text-[12.5px] leading-none font-bold tracking-[0.14em] text-muted uppercase ${FOCUS_RING}`}>
        {label}
      </h2>
      {amount === null ? null : (
        <p className="flex max-w-full flex-wrap items-baseline justify-center gap-x-[0.16em] font-heading text-[clamp(38px,15cqi,58px)] leading-none font-bold tracking-[-0.045em] tabular-nums [overflow-wrap:anywhere] @[35rem]:text-[clamp(42px,9cqi,80px)]">
          {approximate ? <span className="text-[0.55em] font-medium tracking-normal text-muted">≈</span> : null}
          {/** A new amount (the exact one, or another coin's) rises into place. */}
          <m.span key={amount} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="min-w-0 [overflow-wrap:anywhere]">
            {/** Groups are spaced by margin, not spaces, so selecting and copying the amount gives the plain number. */}
            {amountGroups(amount).map((group, index) => (
              <span key={index} className={`inline-block whitespace-nowrap ${index > 0 ? "ml-[0.2em]" : ""}`}>
                {group}
              </span>
            ))}
          </m.span>
          <span className="text-[0.36em] font-semibold tracking-normal text-muted">{symbol}</span>
        </p>
      )}
      {networkNote ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-bg py-[3px] pr-3 pl-1 text-[13px] font-semibold text-warn">
          {chain ? <ChainBadge chain={chain} className="size-4 text-[8px]" /> : null}
          {networkNote}
        </span>
      ) : null}
      <div className="inline-flex max-w-full items-center gap-2.5 rounded-full border border-line bg-surface py-[5px] pr-[5px] pl-[7px] pointer-coarse:py-[3px] pointer-coarse:pr-[3px]">
        <CoinChainIcon symbol={symbol} blockchain={blockchain} className="size-7 text-[10px]" badgeClassName="size-3.5 text-[7px]" />
        <span className="min-w-0 truncate font-heading text-sm font-semibold">
          {symbol} <span className="text-[13.5px] font-medium text-muted">{onChain}</span>
        </span>
        {onChange ? (
          <button
            type="button"
            onClick={onChange}
            className={`h-8 shrink-0 rounded-full bg-surface-2 px-3.5 pointer-coarse:h-11 pointer-coarse:px-4 font-heading text-[13px] font-semibold whitespace-nowrap text-accent-text transition-colors hover:bg-accent/12 ${FOCUS_RING}`}
          >
            {changeLabel}
          </button>
        ) : (
          <span className="pr-2" />
        )}
      </div>
    </div>
  );
}
