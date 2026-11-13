import { z } from "zod";
import type { Mode, Quote } from "@/generated/prisma/client";
import { ApiError } from "@/lib/api/errors";
import { getDb } from "@/lib/db";
import { isRefusal, oneClickMessage } from "@/lib/oneclick/client";
import { paymentNetwork } from "@/lib/oneclick/network";
import type { StatusResponse } from "@/lib/oneclick/types";
import { applyStatus } from "@/lib/payments/apply-status";
import { notifyCheckout } from "@/lib/payments/checkout-events";
import { closedInvoice } from "@/lib/payments/quote";
import { lockInvoice } from "@/lib/row-locks";

/** A transaction hash or signature on any supported chain, as customers paste it. */
export const txHashSchema = z
  .string({ error: "tx_hash is required." })
  .trim()
  .min(8, "tx_hash looks too short.")
  .max(200)
  .regex(/^[A-Za-z0-9:_\-.]+$/, "tx_hash contains characters a transaction hash cannot have.");

/** A transaction hash, or `wallet_sent` from a wallet that sends without returning one (TON). */
export const reportDepositSchema = z
  .strictObject({
    tx_hash: txHashSchema.optional(),
    wallet_sent: z.literal(true, { error: "wallet_sent can only be true." }).optional(),
    payment_id: z.string().min(1).max(60).optional(),
  })
  .refine((input) => (input.tx_hash === undefined) !== (input.wallet_sent === undefined), {
    error: "Send tx_hash, or wallet_sent: true when the wallet returned no transaction hash.",
    path: ["tx_hash"],
  });

export const simulateSchema = z.strictObject({
  outcome: z.enum(["paid", "underpaid", "refunded", "failed"], { error: "outcome must be paid, underpaid, refunded or failed." }),
});

/** The invoice's newest watched payment, or the one `paymentId` names; otherwise throws why (unknown invoice, paid, or no coin chosen yet). */
async function openQuote(invoiceId: string, paymentId?: string): Promise<Quote & { invoice: { mode: Mode } }> {
  const db = getDb();
  const quote = await db.quote.findFirst({
    where: { invoiceId, state: { in: ["active", "retired"] }, ...(paymentId ? { id: paymentId } : {}) },
    orderBy: { createdAt: "desc" },
    include: { invoice: { select: { mode: true } } },
  });
  if (quote) return quote;
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId }, select: { status: true } });
  if (!invoice) throw new ApiError(404, "not_found", "No invoice with this id.", "id");
  if (paymentId) throw new ApiError(404, "not_found", "No open payment with this id on the invoice.", "payment_id");
  if (invoice.status === "paid") throw closedInvoice("invoice_paid", "This invoice is already paid.");
  throw new ApiError(409, "invalid_state", "Choose a coin to start a payment first.");
}

/** Records the customer's transaction hash and reports it to 1Click to speed up detection; `paymentId` keeps a newer address from taking it. */
export async function reportDeposit(invoiceId: string, txHash: string, paymentId?: string): Promise<void> {
  const quote = await openQuote(invoiceId, paymentId);
  let response: StatusResponse;
  try {
    response = await paymentNetwork(quote.invoice.mode).reportDeposit(quote, txHash);
  } catch (error) {
    if (isRefusal(error)) {
      throw new ApiError(422, "quote_unavailable", `The payment network could not match this transaction yet: ${oneClickMessage(error)}`, "tx_hash");
    }
    throw error;
  }
  /** Saved only once the network accepts it, so a mistyped hash does not block switching coins; the lock orders it with createQuote. */
  await getDb().$transaction(async (tx) => {
    await lockInvoice(tx, invoiceId);
    await tx.quote.update({ where: { id: quote.id }, data: { depositTxHash: txHash } });
    /** The address now counts as reported; other open checkouts learn it now, not at their fallback poll. */
    await notifyCheckout(tx, invoiceId);
  });
  await applyStatus(quote.id, response);
}

/** Records that the customer's wallet sent the payment without returning a hash, so the address counts as reported (`reportedInFlight`):
    a reload or another device does not offer it for a second payment. Nothing is sent to 1Click, which needs a hash; polling finds it. */
export async function reportWalletSent(invoiceId: string, paymentId?: string): Promise<void> {
  const quote = await openQuote(invoiceId, paymentId);
  await getDb().$transaction(async (tx) => {
    await lockInvoice(tx, invoiceId);
    await tx.quote.update({ where: { id: quote.id }, data: { walletSentAt: new Date(), nextPollAt: new Date() } });
    await notifyCheckout(tx, invoiceId);
  });
}

/** Test mode only: the mock walks the open payment to `outcome`; the first step is applied at once, the worker applies the rest. */
export async function simulatePayment(invoiceId: string, outcome: z.infer<typeof simulateSchema>["outcome"]): Promise<void> {
  /** Live invoices answer as if they did not exist, as the API reference says, before anything about their payments is read. */
  const invoice = await getDb().invoice.findUnique({ where: { id: invoiceId }, select: { mode: true } });
  if (invoice?.mode !== "test") throw new ApiError(404, "not_found", "No invoice with this id.", "id");
  const quote = await openQuote(invoiceId);
  const simulated = await getDb().quote.update({
    where: { id: quote.id },
    /** Due at once, so the worker picks the payment up even if applying its first step below fails. */
    data: { simulatedOutcome: outcome, simulatedAt: new Date(), nextPollAt: new Date() },
  });
  await applyStatus(simulated.id, await paymentNetwork("test").status(simulated));
}
