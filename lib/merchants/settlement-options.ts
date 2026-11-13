import { chainForToken, getChain } from "@/lib/chains/registry";
import { listTokens } from "@/lib/oneclick/tokens";
import type { OneClickToken } from "@/lib/oneclick/types";
import { EARN_ASSETS } from "@/lib/payments/earn";

export type SettlementOption = { assetId: string; symbol: string; label: string; earn: boolean };

const STABLES = ["USDC", "USDT"];

/** Coins receivable on a payout chain (stablecoins, native coin, Earn shares); display-only pages pass `displayTokens` to open while 1Click is down. */
export async function settlementOptions(payoutChain: string, tokenList: () => Promise<OneClickToken[]> = listTokens): Promise<SettlementOption[]> {
  const chainName = getChain(payoutChain)?.name ?? payoutChain;
  const tokens = (await tokenList()).filter((token) => chainForToken(token)?.id === payoutChain);
  const options: SettlementOption[] = [];
  for (const symbol of STABLES) {
    const token = tokens.find((t) => t.symbol === symbol);
    if (token) options.push({ assetId: token.assetId, symbol, label: `${symbol} on ${chainName}`, earn: false });
  }
  const native = tokens.find((t) => !t.contractAddress);
  if (native) options.push({ assetId: native.assetId, symbol: native.symbol, label: `${native.symbol} on ${chainName} (native coin)`, earn: false });
  for (const token of tokens) {
    const earn = EARN_ASSETS[token.assetId];
    if (earn) options.push({ assetId: token.assetId, symbol: token.symbol, label: `Earn: ${earn.vault}`, earn: true });
  }
  return options;
}
