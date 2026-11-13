import type { TransferKind, TransferStatus } from "@/generated/prisma/client";
import { chainForToken } from "@/lib/chains/registry";
import { getDb } from "@/lib/db";
import { bucketLabel, periodEdges, type Period, utcDayStart } from "@/lib/merchants/stat-periods";
import { displayTokens } from "@/lib/oneclick/tokens";
import { splitOnHold } from "@/lib/transfers/kinds";

const PERIODS: readonly Period[] = ["7d", "30d", "12m"];

export const TRANSFER_ROWS = 1000;

export type TransferRow = {
  id: string;
  kind: TransferKind;
  status: TransferStatus;
  /** Amount of the coin that leaves the merchant's wallet, with its symbol. */
  amount: string;
  symbol: string;
  /** What the recipient gets, such as "USDT on TRON". */
  destination: string;
  recipient: string;
  createdAt: string;
  /** A split payout waiting for a refund of its payment to end (`splitOnHold`). */
  onHold: boolean;
};

export type TransferBucket = { label: string; title: string; refundsUsd: number; payoutsUsd: number; withdrawalsUsd: number };

export type TransferPeriod = { buckets: TransferBucket[]; sentUsd: number; sent: number };

type TransferStats = {
  /** The newest TRANSFER_ROWS transfers; the chart and the paid-out total use the same rows. */
  rows: TransferRow[];
  /** Counts over every transfer. */
  pending: number;
  completed: number;
  failed: number;
  /** Completed refunds and payouts at current coin prices; Earn withdrawals stay in the merchant's wallet and are left out. */
  paidOutUsd: number;
  periods: Record<Period, TransferPeriod>;
};

const KIND_FIELD = { refund: "refundsUsd", payout: "payoutsUsd", withdrawal: "withdrawalsUsd" } as const;

/** The newest refunds, payouts and Earn withdrawals with status counts and the value sent per day or month. */
export async function transferStats(merchantId: string): Promise<TransferStats> {
  const db = getDb();
  const [transfers, statusCounts, tokens] = await Promise.all([
    db.transfer.findMany({ where: { merchantId }, orderBy: { createdAt: "desc" }, take: TRANSFER_ROWS }),
    db.transfer.groupBy({ by: ["status"], where: { merchantId }, _count: { _all: true } }),
    displayTokens().then((list) => new Map(list.map((token) => [token.assetId, token]))),
  ]);
  const usd = (amount: string, assetId: string) => Number(amount) * (tokens.get(assetId)?.price ?? 0);
  const coin = (assetId: string) => {
    const token = tokens.get(assetId);
    return token ? `${token.symbol} on ${chainForToken(token)?.name ?? token.blockchain}` : assetId;
  };

  /** A completed transfer is not updated again, so its updatedAt is when it completed. */
  const sent = transfers.filter((transfer) => transfer.status === "completed").map((transfer) => ({ kind: transfer.kind, at: transfer.updatedAt.getTime(), usd: usd(transfer.amount, transfer.sourceAsset) }));
  const todayStart = utcDayStart();

  const periodStats = (period: Period): TransferPeriod => {
    const edges = periodEdges(period, todayStart);
    const buckets = edges.slice(0, -1).map((start, index): TransferBucket => {
      const bucket: TransferBucket = { ...bucketLabel(period, start), refundsUsd: 0, payoutsUsd: 0, withdrawalsUsd: 0 };
      for (const transfer of sent) if (transfer.at >= start && transfer.at < edges[index + 1]) bucket[KIND_FIELD[transfer.kind]] += transfer.usd;
      return bucket;
    });
    const inPeriod = sent.filter((transfer) => transfer.at >= edges[0] && transfer.at < edges[edges.length - 1]);
    return { buckets, sentUsd: inPeriod.reduce((total, transfer) => total + transfer.usd, 0), sent: inPeriod.length };
  };

  const count = (status: TransferStatus) => statusCounts.find((entry) => entry.status === status)?._count._all ?? 0;
  return {
    rows: transfers.map((transfer) => ({
      id: transfer.id,
      kind: transfer.kind,
      status: transfer.status,
      amount: transfer.amount,
      symbol: tokens.get(transfer.sourceAsset)?.symbol ?? "",
      destination: coin(transfer.destinationAsset),
      recipient: transfer.recipient,
      createdAt: transfer.createdAt.toISOString(),
      onHold: splitOnHold(transfer),
    })),
    pending: count("pending"),
    completed: count("completed"),
    failed: count("failed"),
    paidOutUsd: sent.filter((transfer) => transfer.kind !== "withdrawal").reduce((total, transfer) => total + transfer.usd, 0),
    periods: Object.fromEntries(PERIODS.map((period) => [period, periodStats(period)])) as Record<Period, TransferPeriod>,
  };
}

/** One transfer of the merchant; null when no transfer with this id belongs to them. */
export function transferDetail(merchantId: string, id: string) {
  return getDb().transfer.findFirst({ where: { id, merchantId } });
}
