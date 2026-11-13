import {
  NetworkAbstract,
  NetworkAptos,
  NetworkArbitrumOne,
  NetworkAvalanche,
  NetworkBase,
  NetworkBerachain,
  NetworkBinanceSmartChain,
  NetworkBitcoin,
  NetworkCardano,
  NetworkEthereum,
  NetworkGnosis,
  NetworkHyperEvm,
  NetworkLitecoin,
  NetworkMonad,
  NetworkNearProtocol,
  NetworkOptimism,
  NetworkPlasma,
  NetworkPolygon,
  NetworkScroll,
  NetworkSolana,
  NetworkStarknet,
  NetworkStellar,
  NetworkSui,
  NetworkTon,
  NetworkTron,
  NetworkXLayer,
  NetworkXrp,
  TokenBCH,
  TokenDASH,
  TokenDOGE,
  TokenZEC,
} from "@web3icons/react";
import type { ComponentType } from "react";
import { textOn } from "@/components/ui/text-on";
import type { ChainInfo } from "@/lib/chains/registry";

type Logo = ComponentType<{ variant?: "mono" | "branded" | "background"; className?: string }>;

/** Each network's logo by 1Click code. Dogecoin, Bitcoin Cash, Dash and Zcash use their coin's logo. */
const LOGOS: Record<string, Logo> = {
  near: NetworkNearProtocol,
  eth: NetworkEthereum,
  base: NetworkBase,
  arb: NetworkArbitrumOne,
  op: NetworkOptimism,
  pol: NetworkPolygon,
  bsc: NetworkBinanceSmartChain,
  avax: NetworkAvalanche,
  gnosis: NetworkGnosis,
  bera: NetworkBerachain,
  monad: NetworkMonad,
  xlayer: NetworkXLayer,
  scroll: NetworkScroll,
  plasma: NetworkPlasma,
  abs: NetworkAbstract,
  hypercore: NetworkHyperEvm,
  sol: NetworkSolana,
  tron: NetworkTron,
  btc: NetworkBitcoin,
  ltc: NetworkLitecoin,
  doge: TokenDOGE,
  bch: TokenBCH,
  dash: TokenDASH,
  zec: TokenZEC,
  xrp: NetworkXrp,
  stellar: NetworkStellar,
  ton: NetworkTon,
  sui: NetworkSui,
  aptos: NetworkAptos,
  cardano: NetworkCardano,
  starknet: NetworkStarknet,
};

/** A network's logo in a round badge; a network without a logo shows its first letter on its brand color. */
export function ChainBadge({ chain, className = "size-[22px] text-[10.5px]" }: { chain: Pick<ChainInfo, "id" | "name" | "color">; className?: string }) {
  const Logo = LOGOS[chain.id];
  if (Logo) {
    return (
      <span aria-hidden="true" className={`inline-grid shrink-0 overflow-hidden rounded-full ${className}`}>
        <Logo variant="background" className="size-full" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={`inline-grid shrink-0 place-items-center rounded-full font-bold ${className}`} style={{ background: chain.color, color: textOn(chain.color) }}>
      {chain.name[0]}
    </span>
  );
}
