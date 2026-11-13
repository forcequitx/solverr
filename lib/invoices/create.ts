import type { Invoice, Merchant, Mode, Prisma } from "@/generated/prisma/client";
import { ApiError } from "@/lib/api/errors";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/ids";
import { type CreateInvoiceInput, INVOICE_LIFETIME_SECONDS } from "@/lib/invoices/schema";
import { settlementAmountBase } from "@/lib/invoices/settlement";
import { findToken, withinRequestWait } from "@/lib/oneclick/tokens";

/** The payment link, subscription or credit account an invoice was created for. */
type InvoiceSource = Pick<Prisma.InvoiceUncheckedCreateInput, "paymentLinkId" | "subscriptionId" | "creditAccountId">;

/** Prices the invoice in the merchant's settlement coin and returns the row to create; it calls the network, so run it outside a transaction.
    With `waiting` (someone waits on the answer) a cold token load is bounded; the worker, with nobody waiting, passes false. */
export async function invoiceData(
  merchant: Merchant,
  mode: Mode,
  input: CreateInvoiceInput,
  source: InvoiceSource = {},
  waiting = true,
): Promise<Prisma.InvoiceUncheckedCreateInput> {
  const lookup = findToken(merchant.settlementAsset);
  const token = await (waiting ? withinRequestWait(lookup) : lookup);
  if (!token) {
    throw new ApiError(400, "invalid_request", "The coin you receive is no longer supported. Choose another one in Settings.");
  }

  const amountOut = await settlementAmountBase(input.amount, input.currency, token);
  if (amountOut <= 0n) {
    throw new ApiError(400, "invalid_request", "amount is too small to settle. Use a larger amount.", "amount");
  }

  const lifetime = input.expires_in ?? INVOICE_LIFETIME_SECONDS.default;
  return {
    id: newId("inv"),
    merchantId: merchant.id,
    mode,
    amount: input.amount,
    currency: input.currency,
    destinationAsset: token.assetId,
    destinationSymbol: token.symbol,
    destinationChain: token.blockchain,
    destinationDecimals: token.decimals,
    amountOutBase: amountOut.toString(),
    orderId: input.order_id,
    description: input.description,
    customerEmail: input.customer_email,
    redirectUrl: input.redirect_url,
    metadata: input.metadata,
    expiresAt: new Date(Date.now() + lifetime * 1000),
    ...source,
  };
}

export async function createInvoice(merchant: Merchant, mode: Mode, input: CreateInvoiceInput, source: InvoiceSource = {}): Promise<Invoice> {
  return getDb().invoice.create({ data: await invoiceData(merchant, mode, input, source) });
}
