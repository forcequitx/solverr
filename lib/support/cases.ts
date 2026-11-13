import { z } from "zod";
import type { SupportCaseKind } from "@/generated/prisma/client";
import { ApiError } from "@/lib/api/errors";
import { getChain } from "@/lib/chains/registry";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/ids";
import { serializeInvoice } from "@/lib/invoices/serialize";
import { createAlert } from "@/lib/merchants/alerts";
import { txHashSchema } from "@/lib/payments/deposit";
import { caseKindLabel } from "@/lib/support/case-kinds";
import { DAY_MS } from "@/lib/time";
import { enqueueWebhook } from "@/lib/webhooks/events";

export const NEAR_INTENTS_SUPPORT_URL = "https://t.me/near_intents";

export const lookupSchema = z
  .object({ invoice_id: z.string().min(1).max(60).optional(), tx_hash: txHashSchema.optional() })
  .refine((value) => value.invoice_id || value.tx_hash, "Enter the payment ID or your transaction hash.");

export const createCaseSchema = z.strictObject({
  invoice_id: z.string().min(1).max(60).optional(),
  tx_hash: txHashSchema,
  chain: z.string().regex(/^[a-z0-9_-]{1,30}$/, "chain must be a network id such as base or near."),
  kind: z.enum(["wrong_chain", "wrong_coin", "missing_memo", "stuck", "not_found"]),
  details: z.string().max(1000).optional(),
});

/** Cases one invoice can collect within a day; repeats beyond this are refused. */
const MAX_CASES_PER_INVOICE = 5;
const CASE_WINDOW_MS = DAY_MS;
/** Cases per business a day that raise an alert and webhook; anyone can open cases, so later ones are only listed on the Support page. */
const MAX_CASE_NOTICES_PER_MERCHANT = 30;

type InvoiceMatch = { invoiceId: string; quoteId?: string; matchedBy: "invoice_id" | "tx_hash" };

/** Finds the invoice a customer is asking about, by invoice id or by the transaction hash they sent. */
export async function findInvoiceId(input: z.infer<typeof lookupSchema>): Promise<InvoiceMatch | undefined> {
  const db = getDb();
  const sentBy = (hash: string) => ({ originTxs: { array_contains: [{ hash }] } });
  if (input.invoice_id) {
    const invoice = await db.invoice.findUnique({ where: { id: input.invoice_id }, select: { id: true } });
    /** The hash also names which of the invoice's addresses the payment went to, when NEAR Intents saw it. */
    const event = invoice && input.tx_hash ? await db.paymentEvent.findFirst({ where: { ...sentBy(input.tx_hash), quote: { invoiceId: invoice.id } }, select: { quoteId: true } }) : null;
    if (invoice) return { invoiceId: invoice.id, quoteId: event?.quoteId, matchedBy: "invoice_id" };
  }
  if (!input.tx_hash) return undefined;
  const byEvent = await db.paymentEvent.findFirst({ where: sentBy(input.tx_hash), select: { quote: { select: { id: true, invoiceId: true } } } });
  if (byEvent) return { invoiceId: byEvent.quote.invoiceId, quoteId: byEvent.quote.id, matchedBy: "tx_hash" };
  /** Anyone can report any hash on their own invoice, so a reported hash counts only when no other invoice claims it too. */
  const reported = await db.quote.findMany({ where: { depositTxHash: input.tx_hash }, select: { id: true, invoiceId: true }, distinct: ["invoiceId"], take: 2 });
  return reported.length === 1 ? { invoiceId: reported[0].invoiceId, quoteId: reported[0].id, matchedBy: "tx_hash" } : undefined;
}

/** Opens a case with everything NEAR Intents support needs and tells the merchant; a repeat report returns the case still open. */
export async function openSupportCase(input: z.infer<typeof createCaseSchema>) {
  const db = getDb();
  const match = await findInvoiceId({ invoice_id: input.invoice_id, tx_hash: input.tx_hash });
  const invoice = match ? await db.invoice.findUnique({ where: { id: match.invoiceId }, include: { merchant: true, quotes: { orderBy: { createdAt: "desc" } } } }) : null;

  /** A transaction hash is public on chain, so a match by hash alone must not reveal the invoice id; the merchant still sees it. */
  const shown = (report: Record<string, unknown>) => (match?.matchedBy === "invoice_id" ? report : { ...report, invoice_id: null });

  const open = await db.supportCase.findFirst({ where: { invoiceId: invoice?.id ?? null, txHash: input.tx_hash, status: "open" }, orderBy: { createdAt: "desc" } });
  /** An open case may have been reported by someone else, so its free-text details stay with the merchant. */
  if (open) return caseResult(open.id, open.kind, shown({ ...(open.report as Record<string, unknown>), details: null }));
  if (invoice) {
    const recent = await db.supportCase.findMany({
      where: { invoiceId: invoice.id, createdAt: { gte: new Date(Date.now() - CASE_WINDOW_MS) } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
      take: MAX_CASES_PER_INVOICE,
    });
    if (recent.length >= MAX_CASES_PER_INVOICE) {
      const retryAfter = Math.max(1, Math.ceil((recent[0].createdAt.getTime() + CASE_WINDOW_MS - Date.now()) / 1000));
      const message = "This payment already has several support cases from the last 24 hours. Send the report from an earlier case to NEAR Intents support.";
      throw new ApiError(429, "rate_limited", message, undefined, retryAfter, "too_many_attempts");
    }
  }

  const quote = invoice?.quotes.find((q) => q.id === match?.quoteId) ?? invoice?.quotes.find((q) => q.depositTxHash === input.tx_hash) ?? invoice?.quotes[0];

  let kind: SupportCaseKind = input.kind;
  if (quote && getChain(input.chain) && input.chain !== quote.originChain) kind = "wrong_chain";
  if (!invoice) kind = "not_found";

  const report = {
    tx_hash: input.tx_hash,
    chain: input.chain,
    problem: kind,
    details: input.details ?? null,
    invoice_id: invoice?.id ?? null,
    correlation_id: quote?.correlationId ?? null,
    deposit_address: quote?.depositAddress ?? null,
    deposit_memo: quote?.depositMemo ?? null,
    expected: quote ? `${quote.amountInFormatted} ${quote.originSymbol} on ${quote.originChain}` : null,
    quote_signature: quote?.signature ?? null,
  };

  const created = await db.$transaction(async (tx) => {
    const supportCase = await tx.supportCase.create({ data: { id: newId("case"), invoiceId: invoice?.id ?? null, quoteId: quote?.id ?? null, txHash: input.tx_hash, chain: input.chain, kind, report } });
    const notices = invoice ? await tx.supportCase.count({ where: { invoice: { merchantId: invoice.merchantId }, createdAt: { gte: new Date(Date.now() - CASE_WINDOW_MS) } } }) : 0;
    if (invoice && notices <= MAX_CASE_NOTICES_PER_MERCHANT) {
      await createAlert(invoice.merchantId, "support_case", `A customer opened support case ${supportCase.id} (${caseKindLabel(kind)}) for payment ${invoice.id}.`, tx);
      await enqueueWebhook(tx, invoice.merchant, invoice.mode, "support_case.created", { support_case: { id: supportCase.id, kind, report }, invoice: serializeInvoice(invoice) });
    }
    return supportCase;
  });
  return caseResult(created.id, kind, shown(report));
}

/** The case id plus the report text the customer copies to NEAR Intents support. */
function caseResult(id: string, kind: SupportCaseKind, report: Record<string, unknown>) {
  const reportText = [
    `Solverr support case ${id}`,
    ...Object.entries(report)
      .filter(([, value]) => value)
      .map(([key, value]) => `${key.replace(/_/g, " ")}: ${value}`),
  ].join("\n");
  return { id, kind, report_text: reportText, support_url: NEAR_INTENTS_SUPPORT_URL };
}
