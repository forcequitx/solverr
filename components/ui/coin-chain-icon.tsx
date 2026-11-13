import { ChainBadge } from "@/components/ui/chain-badge";
import { CoinIcon } from "@/components/ui/coin-icon";
import { getChain } from "@/lib/chains/registry";

/** A coin's logo with its network's logo as a small badge on the lower right, ringed in the surface color. */
export function CoinChainIcon({
  symbol,
  blockchain,
  className = "size-[30px] text-[11px]",
  badgeClassName = "size-[15px] text-[7px]",
}: {
  symbol: string;
  blockchain: string;
  className?: string;
  badgeClassName?: string;
}) {
  const chain = getChain(blockchain);
  return (
    <span className="relative inline-grid shrink-0">
      <CoinIcon symbol={symbol} className={className} />
      {chain ? <ChainBadge chain={chain} className={`absolute -right-[3px] -bottom-[3px] ring-2 ring-surface ${badgeClassName}`} /> : null}
    </span>
  );
}
