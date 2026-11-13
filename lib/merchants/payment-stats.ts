import type { InvoiceStatus, Mode } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { resourceOf } from "@/lib/merchants/stat-periods";

export type PaymentRow = {
  id: string;
  createdAt: Date;
  orderId: string | null;
  description: string | null;
  amount: string;
  currency: string;
  status: string;
  paidWith: { symbol: string; chain: string; amount: string } | null;
  agent: boolean;
};

/** Newest invoices with the coin they were paid with, for dashboard tables and CSV export. */
export async function paymentRows(merchantId: string, mode: Mode, options: { take: number; status?: InvoiceStatus }): Promise<PaymentRow[]> {
  const db = getDb();
  const invoices = await db.invoice.findMany({
    where: { merchantId, mode, ...(options.status ? { status: options.status } : {}) },
    orderBy: { createdAt: "desc" },
    take: options.take,
  });
  /** The quote that paid may be older than the newest one, so it is looked up by id. */
  const paidQuoteIds = invoices.flatMap((invoice) => (invoice.paidQuoteId ? [invoice.paidQuoteId] : []));
  const paidQuotes = new Map((await db.quote.findMany({ where: { id: { in: paidQuoteIds } } })).map((quote) => [quote.id, quote]));
  return invoices.map((invoice) => {
    const quote = invoice.paidQuoteId ? paidQuotes.get(invoice.paidQuoteId) : undefined;
    return {
      id: invoice.id,
      createdAt: invoice.createdAt,
      orderId: invoice.orderId,
      description: invoice.description,
      amount: invoice.amount.toFixed(2),
      currency: invoice.currency,
      status: invoice.status,
      paidWith: quote ? { symbol: quote.originSymbol, chain: quote.originChain, amount: quote.amountInFormatted } : null,
      agent: resourceOf(invoice.metadata) !== null,
    };
  });
}

/** One invoice of the business with its quotes, support cases, webhook deliveries and refunds for the payment page, or null when not found. */
export async function paymentDetail(merchantId: string, mode: Mode, id: string) {
  const db = getDb();
  const invoice = await db.invoice.findFirst({
    where: { id, merchantId, mode },
    include: { quotes: { orderBy: { createdAt: "desc" }, include: { events: { orderBy: { receivedAt: "asc" } } } }, supportCases: true },
  });
  if (!invoice) return null;
  const deliveries = await db.webhookDelivery.findMany({
    where: { merchantId, createdAt: { gte: invoice.createdAt }, payload: { path: ["data", "invoice", "id"], equals: invoice.id } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  /** Refunds of this invoice's payments, so a refund waiting for approval is found here instead of being created twice. */
  const refunds = await db.transfer.findMany({ where: { merchantId, kind: "refund", invoiceId: invoice.id }, orderBy: { createdAt: "desc" } });
  return { invoice, deliveries, refunds };
}
