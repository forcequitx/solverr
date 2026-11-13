import type { Merchant } from "@/generated/prisma/client";
import { rateLimit } from "@/lib/api/rate-limit";
import { settlementOptions } from "@/lib/merchants/settlement-options";
import { USDC_ON_ARBITRUM, USDC_ON_BASE } from "@/lib/oneclick/constants";
import { findToken } from "@/lib/oneclick/tokens";
import { probeRoute } from "@/lib/payments/route-limits";

/** Coins that pay the checked coin (the first that differs from it); some coins, such as USDC on HyperEVM, are refused as origins yet deliver fine. */
const REFERENCE_ORIGINS = [USDC_ON_ARBITRUM, USDC_ON_BASE];

/** Whether NEAR Intents takes a small payment into a settlement coin right now; `minimumUsd` is the dollar floor it names. */
export type SettlementCheck = { refused: false } | { refused: true; minimumUsd: string | null };

/** Dry-quotes $1 of the coin into the payout wallet from a reference coin; null when the answer is unknown (network trouble, unpriced coin). */
async function checkSettlementCoin(assetId: string, payoutAddress: string): Promise<SettlementCheck | null> {
  const [token, origin] = await Promise.all([findToken(assetId), findToken(REFERENCE_ORIGINS.find((id) => id !== assetId)!)]);
  if (!token?.price || !origin) return null;
  const probe = await probeRoute(origin, token, 1, payoutAddress);
  if (!probe) return null;
  return probe.ok ? { refused: false } : { refused: true, minimumUsd: probe.minimumUsd === null ? null : String(probe.minimumUsd) };
}

/** How long a definite answer is reused; the coin-you-receive form asks on every coin selected, and each fresh answer is a 1Click dry quote. */
const CHECK_TTL_MS = 5 * 60_000;
const MAX_CACHED_CHECKS = 500;
/** Definite answers by coin and payout address, kept per server instance. */
const recentChecks = new Map<string, { check: SettlementCheck; expiresAt: number }>();

/** Checks a coin the merchant can receive on their payout network; null when there is nothing to check or the answer is unknown. */
export async function merchantSettlementCheck(merchant: Pick<Merchant, "id" | "payoutChain" | "payoutAddress">, assetId: string): Promise<SettlementCheck | null> {
  if (!merchant.payoutChain || !merchant.payoutAddress) return null;
  await rateLimit(`settlement-check:${merchant.id}`, 30, 60_000);
  const option = (await settlementOptions(merchant.payoutChain)).find((candidate) => candidate.assetId === assetId);
  /** Earn vault shares are not checked, so they have no answer. */
  if (!option || option.earn) return null;
  const key = `${assetId}:${merchant.payoutAddress}`;
  const cached = recentChecks.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.check;
  const check = await checkSettlementCoin(assetId, merchant.payoutAddress);
  if (check) {
    if (recentChecks.size >= MAX_CACHED_CHECKS) recentChecks.clear();
    recentChecks.set(key, { check, expiresAt: Date.now() + CHECK_TTL_MS });
  }
  return check;
}
