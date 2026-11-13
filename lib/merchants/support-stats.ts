import type { Mode, SupportCaseKind } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { DAY_MS } from "@/lib/time";

export const RECENT_CASE_DAYS = 30;

export type SupportSummary = {
  open: number;
  resolved: number;
  /** Cases opened in the last `RECENT_CASE_DAYS` days. */
  recent: number;
  byKind: Partial<Record<SupportCaseKind, { total: number; open: number }>>;
};

/** Counts of every support case on the merchant's payments in `mode`, by status and by problem. */
export async function supportSummary(merchantId: string, mode: Mode): Promise<SupportSummary> {
  const where = { invoice: { merchantId, mode } };
  const db = getDb();
  const [groups, recent] = await Promise.all([
    db.supportCase.groupBy({ by: ["status", "kind"], where, _count: { _all: true } }),
    db.supportCase.count({ where: { ...where, createdAt: { gte: new Date(Date.now() - RECENT_CASE_DAYS * DAY_MS) } } }),
  ]);

  const summary: SupportSummary = { open: 0, resolved: 0, recent, byKind: {} };
  for (const group of groups) {
    const count = group._count._all;
    summary[group.status] += count;
    const kind = (summary.byKind[group.kind] ??= { total: 0, open: 0 });
    kind.total += count;
    if (group.status === "open") kind.open += count;
  }
  return summary;
}

/** The newest `take` support cases of the merchant's payments in `mode`. */
export function supportCases(merchantId: string, mode: Mode, take: number) {
  return getDb().supportCase.findMany({ where: { invoice: { merchantId, mode } }, orderBy: { createdAt: "desc" }, take });
}
