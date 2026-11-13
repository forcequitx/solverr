import type { Mode } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";

export type LinkUsage = {
  /** Checkouts opened from the link (one invoice per visit). */
  checkouts: number;
  paid: number;
  /** Sum of paid invoice amounts in the link's currency, as a decimal string. */
  collected: string;
};

type LinkTotals = { links: number; activeLinks: number; checkouts: number; paid: number };

/** Checkouts and paid invoices per payment link, for the given links. */
export async function linkUsage(merchantId: string, mode: Mode, linkIds: string[]): Promise<Map<string, LinkUsage>> {
  const db = getDb();
  const where = { merchantId, mode, paymentLinkId: { in: linkIds } };
  const [created, paid] = await Promise.all([
    db.invoice.groupBy({ by: ["paymentLinkId"], where, _count: { _all: true } }),
    db.invoice.groupBy({ by: ["paymentLinkId"], where: { ...where, status: "paid" }, _count: { _all: true }, _sum: { amount: true } }),
  ]);
  const paidByLink = new Map(paid.map((row) => [row.paymentLinkId, row]));
  return new Map(
    created.map((row) => {
      const paidRow = paidByLink.get(row.paymentLinkId);
      return [row.paymentLinkId!, { checkouts: row._count._all, paid: paidRow?._count._all ?? 0, collected: (paidRow?._sum.amount ?? 0).toFixed(2) }];
    }),
  );
}

/** Link counts and the checkouts and paid invoices across every payment link of the merchant. */
export async function linkTotals(merchantId: string, mode: Mode): Promise<LinkTotals> {
  const db = getDb();
  const fromLinks = { merchantId, mode, paymentLinkId: { not: null } };
  const [links, activeLinks, checkouts, paid] = await Promise.all([
    db.paymentLink.count({ where: { merchantId, mode } }),
    db.paymentLink.count({ where: { merchantId, mode, active: true } }),
    db.invoice.count({ where: fromLinks }),
    db.invoice.count({ where: { ...fromLinks, status: "paid" } }),
  ]);
  return { links, activeLinks, checkouts, paid };
}

/** The merchant's newest `take` payment links in `mode`. */
export function linkRows(merchantId: string, mode: Mode, take: number) {
  return getDb().paymentLink.findMany({ where: { merchantId, mode }, orderBy: { createdAt: "desc" }, take });
}

/** The merchant's active payment links in `mode`, newest first: the ones a pay button can open. */
export function activeLinkOptions(merchantId: string, mode: Mode) {
  return getDb().paymentLink.findMany({ where: { merchantId, mode, active: true }, orderBy: { createdAt: "desc" }, select: { id: true, title: true } });
}
