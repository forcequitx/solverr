import type { Invoice, Merchant, OneClickStatus, Prisma, Quote } from "@/generated/prisma/client";
import { topUp } from "@/lib/credits/credits";
import type { StatusResponse } from "@/lib/oneclick/types";
import { applyStatus } from "@/lib/payments/apply-status";
import { createQuote } from "./factories";

/** Settles invoices the way the worker does, by applying 1Click statuses with `applyStatus`. */

const DEPOSIT_TX = `0x${"de".repeat(32)}`;

/** 1Click's status answer for `quote`; every status after the deposit names its deposit transaction. */
export function oneClickStatus(quote: Pick<Quote, "correlationId" | "amountIn">, status: OneClickStatus): StatusResponse {
  const deposited = status !== "PENDING_DEPOSIT";
  return {
    correlationId: quote.correlationId,
    status,
    updatedAt: new Date().toISOString(),
    swapDetails: {
      intentHashes: [],
      nearTxHashes: [],
      originChainTxHashes: deposited ? [{ hash: DEPOSIT_TX, explorerUrl: "" }] : [],
      destinationChainTxHashes: [],
      depositedAmount: deposited ? quote.amountIn : undefined,
    },
  };
}

/** Pays the invoice with a new quote that NEAR Intents reports as finished; on an already paid invoice it is an extra payment. */
export async function payInvoice(invoice: Pick<Invoice, "id">, overrides: Partial<Prisma.QuoteUncheckedCreateInput> = {}): Promise<Quote> {
  const quote = await createQuote(invoice, overrides);
  await applyStatus(quote.id, oneClickStatus(quote, "SUCCESS"));
  return quote;
}

/** A credit account topped up with `amount` USD through a paid top-up invoice; returns its token, as the agent holds it. */
export async function fundCredits(merchant: Merchant, amount: string) {
  const { credit_account, invoice } = await topUp(merchant, { amount, currency: "USD" });
  const quote = await payInvoice(invoice);
  return { accountId: credit_account.id, token: credit_account.token!, invoiceId: invoice.id, quote };
}
