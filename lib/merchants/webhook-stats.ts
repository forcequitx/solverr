import type { WebhookDeliveryStatus } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { dayLabel, STATS_ROW_LIMIT, utcDayStart } from "@/lib/merchants/stat-periods";
import { DAY_MS } from "@/lib/time";

export const DELIVERY_DAYS = 14;

type DeliveryDay = { label: string; title: string } & Record<WebhookDeliveryStatus, number>;

export type DeliveryHealth = { days: DeliveryDay[] } & Record<WebhookDeliveryStatus, number>;

/** Webhook deliveries of the last 14 UTC days by current status, per day and in total; the daily split reads at most STATS_ROW_LIMIT rows. */
export async function deliveryHealth(merchantId: string): Promise<DeliveryHealth> {
  const from = utcDayStart() - (DELIVERY_DAYS - 1) * DAY_MS;
  const where = { merchantId, createdAt: { gte: new Date(from) } };
  const db = getDb();
  const [rows, totals] = await Promise.all([
    db.webhookDelivery.findMany({ where, select: { createdAt: true, status: true }, orderBy: { createdAt: "desc" }, take: STATS_ROW_LIMIT }),
    db.webhookDelivery.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);

  const days = Array.from({ length: DELIVERY_DAYS }, (_, index): DeliveryDay => ({ ...dayLabel(from + index * DAY_MS), delivered: 0, failed: 0, pending: 0 }));
  for (const row of rows) {
    const day = days[Math.floor((row.createdAt.getTime() - from) / DAY_MS)];
    if (day) day[row.status] += 1;
  }
  const total = (status: WebhookDeliveryStatus) => totals.find((group) => group.status === status)?._count._all ?? 0;

  return { days, delivered: total("delivered"), failed: total("failed"), pending: total("pending") };
}

/** The merchant's newest `take` webhook deliveries, for the delivery log. */
export function recentDeliveries(merchantId: string, take: number) {
  return getDb().webhookDelivery.findMany({ where: { merchantId }, orderBy: { createdAt: "desc" }, take });
}
