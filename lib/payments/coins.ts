import { chainForToken } from "@/lib/chains/registry";
import type { OneClickToken } from "@/lib/oneclick/types";

export type CheckoutCoin = {
  assetId: string;
  symbol: string;
  blockchain: string;
  chainName: string;
  family: string;
  evmChainId: number | null;
  decimals: number;
  priceUsd: number;
  contract: string | null;
  exchangeNeedsMemo: boolean;
  /** The merchant's own settlement coin on its own chain: nothing is swapped, so no swap minimum applies. */
  sameAsSettlement: boolean;
  /** Set when the worker's latest route check says this coin cannot pay this invoice now; `minimumUsd` when a minimum is known. */
  refusal: { minimumUsd: number | null } | null;
  /** The smallest payment in USD the worker's latest route check saw working; null when nothing is known. */
  floorUsd: number | null;
};

const POPULAR = ["USDC", "USDT", "ETH", "SOL", "BTC", "wNEAR", "BNB", "TRX", "XRP", "TON", "DOGE", "LTC"];

/** Payable coins on supported chains: the settlement coin first, then its symbol on other chains (often cheap, but still a swap with a minimum). */
export function checkoutCoins(settlement: { assetId: string; symbol: string }, tokens: OneClickToken[]): CheckoutCoin[] {
  const coins: CheckoutCoin[] = [];
  for (const token of tokens) {
    const chain = chainForToken(token);
    if (!chain || !token.price) continue;
    coins.push({
      assetId: token.assetId,
      symbol: token.symbol,
      blockchain: token.blockchain,
      chainName: chain.name,
      family: chain.family,
      evmChainId: chain.evmChainId ?? null,
      decimals: token.decimals,
      priceUsd: token.price,
      contract: token.contractAddress ?? null,
      exchangeNeedsMemo: !!chain.exchangeNeedsMemo,
      sameAsSettlement: token.assetId === settlement.assetId,
      refusal: null,
      floorUsd: null,
    });
  }
  const rank = (coin: CheckoutCoin) => {
    const popular = POPULAR.indexOf(coin.symbol);
    const tier = coin.sameAsSettlement ? 0 : coin.symbol === settlement.symbol ? 500 : 1000;
    return tier + (popular === -1 ? 100 : popular);
  };
  return coins.sort((a, b) => rank(a) - rank(b) || a.symbol.localeCompare(b.symbol) || a.chainName.localeCompare(b.chainName));
}
