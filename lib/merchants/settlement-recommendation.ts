import { type SettlementOption, settlementOptions } from "@/lib/merchants/settlement-options";
import type { OneClickToken } from "@/lib/oneclick/types";
import { freshCoverage } from "@/lib/payments/route-limits";

/** The candidate with the highest coverage; null unless at least two candidates have one and the leader is strictly ahead of every other. */
export function bestCovered<T>(candidates: readonly T[], coverageOf: (candidate: T) => number | undefined): T | null {
  const ranked = candidates
    .flatMap((candidate) => {
      const coverage = coverageOf(candidate);
      return coverage === undefined ? [] : [{ candidate, coverage }];
    })
    .sort((a, b) => b.coverage - a.coverage);
  if (ranked.length < 2 || ranked[0].coverage === ranked[1].coverage) return null;
  return ranked[0].candidate;
}

/** The coin to tag "Recommended" among a payout network's options: the one most paying coins reach from $1 in the worker's fresh
    route answers. Earn vault shares are left out; null when the answers cannot tell. */
export async function recommendedCoin(options: readonly SettlementOption[]): Promise<string | null> {
  const coins = options.filter((option) => !option.earn);
  const coverage = await freshCoverage(coins.map((option) => option.assetId));
  return bestCovered(coins, (option) => coverage.get(option.assetId))?.assetId ?? null;
}

/** The payout network to tag "Recommended": the one whose best-covered coin leads, by the same measure; null when the answers cannot tell. */
export async function recommendedNetwork(chainIds: readonly string[], tokenList: () => Promise<OneClickToken[]>): Promise<string | null> {
  const networks = await Promise.all(chainIds.map(async (id) => ({ id, coins: (await settlementOptions(id, tokenList)).filter((option) => !option.earn) })));
  const coverage = await freshCoverage(networks.flatMap((network) => network.coins.map((option) => option.assetId)));
  const best = (network: (typeof networks)[number]) => {
    const scores = network.coins.flatMap((option) => coverage.get(option.assetId) ?? []);
    return scores.length > 0 ? Math.max(...scores) : undefined;
  };
  return bestCovered(networks, best)?.id ?? null;
}
