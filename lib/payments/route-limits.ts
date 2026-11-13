import type { RouteLimit } from "@/generated/prisma/client";
import { chainForToken } from "@/lib/chains/registry";
import { getDb } from "@/lib/db";
import { settlementAmountBase } from "@/lib/invoices/settlement";
import { isRefusal, oneClickMessage, requestEstimate } from "@/lib/oneclick/client";
import { REFERRAL } from "@/lib/oneclick/constants";
import { routeMinimumUsd } from "@/lib/oneclick/route-minimum";
import { findToken, listTokens } from "@/lib/oneclick/tokens";
import type { OneClickToken } from "@/lib/oneclick/types";
import { DRY_CHECK_REFUND_ACCOUNT, routeTerms } from "@/lib/payments/quote";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "@/lib/time";

const PROBE_WINDOW_MS = 10 * MINUTE_MS;
/** The first amount every route is tried with. */
const SMALLEST_TEST_USD = 1;
/** Amounts tried in turn when a route is refused without a named minimum, for liquidity that only exists at larger sizes. */
const LIQUIDITY_STEPS_USD = [10, 100] as const;
/** A named minimum is confirmed a little above it, since some routes still lack liquidity there. */
const ABOVE_MINIMUM = 1.05;
/** Rows of routes no longer checked (a settlement coin nobody uses any more) are removed after this long. */
const STALE_ROW_MS = DAY_MS;
/** The checkout trusts an answer for two hours; the worker refreshes every 30 minutes, so a few missed refreshes are tolerated. */
const ANSWER_MAX_AGE_MS = 2 * HOUR_MS;

/** One dry quote's answer: works (with what the payer sends above the amount), refused (with any minimum), or unknown. */
type RouteProbe = { ok: true; feeUsd: number } | { ok: false; minimumUsd: number | null; message: string } | null;

/** Asks 1Click for a dry quote delivering `usd` worth of `destination` to `recipient`, paid with `origin`. */
export async function probeRoute(origin: OneClickToken, destination: OneClickToken, usd: number, recipient: string): Promise<RouteProbe> {
  try {
    const response = await requestEstimate({
      dry: true,
      ...routeTerms(origin, destination),
      swapType: "EXACT_OUTPUT",
      originAsset: origin.assetId,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: destination.assetId,
      amount: (await settlementAmountBase(usd.toFixed(2), "USD", destination)).toString(),
      refundTo: DRY_CHECK_REFUND_ACCOUNT,
      refundType: "INTENTS",
      recipient,
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + PROBE_WINDOW_MS).toISOString(),
      referral: REFERRAL,
    });
    const paid = Number(response.quote.amountInUsd);
    return { ok: true, feeUsd: Number.isFinite(paid) ? Math.max(0, paid - usd) : 0 };
  } catch (error) {
    if (isRefusal(error)) {
      return { ok: false, minimumUsd: routeMinimumUsd(error, origin, destination), message: oneClickMessage(error).slice(0, 300) };
    }
    return null;
  }
}

type RouteAnswer = Pick<RouteLimit, "status"> & { minimumUsd: number | null; feeUsd: number | null; message: string | null };

/** Finds the smallest amount that works on a route: $1, else the named minimum, else the larger liquidity steps. Null when unknown. */
async function measureRoute(origin: OneClickToken, destination: OneClickToken, recipient: string): Promise<RouteAnswer | null> {
  const first = await probeRoute(origin, destination, SMALLEST_TEST_USD, recipient);
  if (!first) return null;
  if (first.ok) return { status: "available", minimumUsd: null, feeUsd: first.feeUsd, message: null };
  const steps = first.minimumUsd ? [Math.ceil(first.minimumUsd * ABOVE_MINIMUM)] : LIQUIDITY_STEPS_USD;
  for (const usd of steps) {
    const probe = await probeRoute(origin, destination, usd, recipient);
    if (!probe) return null;
    if (probe.ok) return { status: "minimum", minimumUsd: first.minimumUsd ?? usd, feeUsd: probe.feeUsd, message: first.message };
  }
  return { status: "unavailable", minimumUsd: first.minimumUsd, feeUsd: null, message: first.message };
}

/** Worker job: measures every route from a payable coin into each settlement coin in use; an unknown answer keeps the previous row. */
export async function refreshRouteLimits(signal: AbortSignal): Promise<number> {
  const db = getDb();
  const merchants = await db.merchant.findMany({
    where: { payoutAddress: { not: null }, payoutVerifiedAt: { not: null } },
    select: { settlementAsset: true, payoutAddress: true },
    distinct: ["settlementAsset"],
  });
  const origins = (await listTokens()).filter((token) => chainForToken(token) && token.price);
  let stored = 0;
  for (const { settlementAsset, payoutAddress } of merchants) {
    const destination = await findToken(settlementAsset);
    if (!destination?.price || !payoutAddress) continue;
    for (const origin of origins) {
      if (signal.aborted) return stored;
      const answer = await measureRoute(origin, destination, payoutAddress);
      if (!answer) continue;
      const row = { ...answer, checkedAt: new Date() };
      await db.routeLimit.upsert({
        where: { originAsset_destinationAsset: { originAsset: origin.assetId, destinationAsset: settlementAsset } },
        create: { originAsset: origin.assetId, destinationAsset: settlementAsset, ...row },
        update: row,
      });
      stored++;
    }
  }
  await db.routeLimit.deleteMany({ where: { checkedAt: { lt: new Date(Date.now() - STALE_ROW_MS) } } });
  return stored;
}

/** Fewest fresh answers into a coin before its coverage counts, so a coin with a handful of answers is never compared. */
const MIN_ANSWERS_TO_COMPARE = 20;

/** For each coin with at least MIN_ANSWERS_TO_COMPARE fresh answers, the share of paying coins whose route works from the first test
    amount; uses only what the worker already measured. */
export async function freshCoverage(destinationAssets: readonly string[]): Promise<Map<string, number>> {
  if (destinationAssets.length === 0) return new Map();
  const groups = await getDb().routeLimit.groupBy({
    by: ["destinationAsset", "status"],
    where: { destinationAsset: { in: [...destinationAssets] }, checkedAt: { gte: new Date(Date.now() - ANSWER_MAX_AGE_MS) } },
    _count: { _all: true },
  });
  const totals = new Map<string, { answers: number; available: number }>();
  for (const group of groups) {
    const total = totals.get(group.destinationAsset) ?? { answers: 0, available: 0 };
    total.answers += group._count._all;
    if (group.status === "available") total.available += group._count._all;
    totals.set(group.destinationAsset, total);
  }
  return new Map([...totals].filter(([, total]) => total.answers >= MIN_ANSWERS_TO_COMPARE).map(([asset, total]) => [asset, total.available / total.answers]));
}

/** Stored route answers for paying a settlement coin, keyed by origin asset id; answers older than ANSWER_MAX_AGE_MS are left out. */
export async function routeLimitsInto(destinationAsset: string): Promise<Map<string, RouteLimit>> {
  const rows = await getDb().routeLimit.findMany({ where: { destinationAsset, checkedAt: { gte: new Date(Date.now() - ANSWER_MAX_AGE_MS) } } });
  return new Map(rows.map((row) => [row.originAsset, row]));
}

/** Whether a stored answer says the route cannot take `amountUsd` now; null when it can, or when nothing is known. */
export function routeRefusal(row: RouteLimit | undefined, amountUsd: number | null): { minimumUsd: number | null } | null {
  if (!row || amountUsd === null || row.status === "available") return null;
  const minimum = row.minimumUsd === null ? null : Number(row.minimumUsd);
  if (row.status === "minimum") return minimum !== null && amountUsd < minimum ? { minimumUsd: minimum } : null;
  /** An unavailable route was only tried up to its largest test amount; a larger payment may still find liquidity. */
  const testedUpTo = minimum !== null ? Math.ceil(minimum * ABOVE_MINIMUM) : LIQUIDITY_STEPS_USD[LIQUIDITY_STEPS_USD.length - 1];
  return amountUsd <= testedUpTo ? { minimumUsd: null } : null;
}

/** The smallest payment a stored answer shows working (its minimum, or the first test amount); null when unknown or unavailable. */
export function routeFloor(row: RouteLimit | undefined): number | null {
  if (row?.status === "available") return SMALLEST_TEST_USD;
  if (row?.status === "minimum" && row.minimumUsd !== null) return Number(row.minimumUsd);
  return null;
}

/** The public shape of a route answer. */
export function serializeRouteLimit(row: RouteLimit) {
  return {
    object: "route_limit",
    origin_asset: row.originAsset,
    destination_asset: row.destinationAsset,
    status: row.status,
    minimum_usd: row.minimumUsd?.toFixed(2) ?? null,
    fee_usd: row.feeUsd?.toFixed(6) ?? null,
    message: row.message,
    checked_at: row.checkedAt.toISOString(),
  };
}
