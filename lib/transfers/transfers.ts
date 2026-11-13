import { z } from "zod";
import type { Invoice, Merchant, Prisma, Quote, Transfer, TransferKind } from "@/generated/prisma/client";
import { ApiError } from "@/lib/api/errors";
import { isValidAddress } from "@/lib/chains/addresses";
import { chainForToken } from "@/lib/chains/registry";
import { takeBackTopUpCredits } from "@/lib/credits/credits";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/ids";
import { formatBaseUnits, toBaseUnits } from "@/lib/money";
import { findToken, listTokens } from "@/lib/oneclick/tokens";
import { isEarnAsset } from "@/lib/payments/earn";
import { lockMerchant, lockMerchantInvoice } from "@/lib/row-locks";
import { resizeSplitPayouts } from "@/lib/splits/splits";

const AMOUNT = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,18})?$/, 'amount must be a decimal string, such as "25.00".')
  .refine((value) => Number(value) > 0, "amount must be greater than 0.");

export const createRefundSchema = z.strictObject({
  invoice_id: z.string({ error: "invoice_id is required." }).min(1),
  /** The payment to refund (quote id); defaults to the payment that paid the invoice. Use it to refund an extra payment. */
  payment_id: z.string().min(1).optional(),
  amount: AMOUNT.optional(),
});

export const createPayoutSchema = z.strictObject({
  recipient: z.string({ error: "recipient is required." }).trim().min(1).max(200),
  asset_id: z.string({ error: "asset_id is required." }).min(1).max(200),
  amount: AMOUNT,
});

/** Checks that the coin is supported and the recipient is a valid address on its chain. */
async function assertRecipient(assetId: string, recipient: string): Promise<void> {
  const token = await findToken(assetId);
  const chain = token && chainForToken(token);
  if (!token || !chain) throw new ApiError(400, "invalid_request", "This coin is not supported.", "asset_id");
  if (!isValidAddress(chain.family, recipient)) throw new ApiError(400, "invalid_request", `recipient is not a valid ${chain.name} address.`, "recipient");
}

type TransferData = { amount: string; sourceAsset: string; destinationAsset: string; recipient: string; invoiceId?: string; quoteId?: string; batchId?: string };

function transferRow(merchant: Merchant, kind: TransferKind, data: TransferData): Prisma.TransferCreateManyInput {
  return {
    id: newId(kind === "refund" ? "ref" : "pay"),
    merchantId: merchant.id,
    kind,
    amount: data.amount,
    sourceAsset: data.sourceAsset,
    destinationAsset: data.destinationAsset,
    recipient: data.recipient,
    invoiceId: data.invoiceId ?? null,
    quoteId: data.quoteId ?? null,
    batchId: data.batchId ?? null,
  };
}

function create(db: Prisma.TransactionClient, merchant: Merchant, kind: TransferKind, data: TransferData) {
  return db.transfer.create({ data: transferRow(merchant, kind, data) });
}

type RefundInvoice = Pick<Invoice, "status" | "destinationChain" | "amountOutBase" | "destinationDecimals" | "destinationSymbol" | "paidQuoteId">;
type EarlierRefund = Pick<Transfer, "id" | "amount" | "status" | "quoteId">;
/** Why `checkRefund` refuses: `refunded` means nothing is left and no refund is open, `refund_open` that an open refund holds the rest. */
type RefundRefusal = "not_paid" | "payout_network" | "no_payment" | "precision" | "refund_open" | "refunded" | "amount";
export type RefundCheck<Q> = { ok: true; payment: Q; amount: bigint; refunded: bigint } | { ok: false; reason: RefundRefusal; error: ApiError };

const refused = (reason: RefundRefusal, error: ApiError) => ({ ok: false, reason, error }) as const;

/** The refund rule, shared by createRefund and the dashboard's Refund buttons: a completed payment of a paid invoice on the current payout
    network, where open and completed refunds never exceed the settled amount. `refunds` are the invoice's refunds in any status;
    the amount defaults to what is left, and `refunded` is what earlier open and completed refunds took. */
export function checkRefund<Q extends Pick<Quote, "id" | "oneclickStatus">>(
  invoice: RefundInvoice & { quotes: readonly Q[] },
  payoutChain: string | null,
  refunds: readonly EarlierRefund[],
  request: { paymentId?: string; amount?: string } = {},
): RefundCheck<Q> {
  if (invoice.status !== "paid") return refused("not_paid", new ApiError(409, "invalid_state", "Only paid invoices can be refunded."));
  if (payoutChain && invoice.destinationChain !== payoutChain) {
    return refused(
      "payout_network",
      new ApiError(409, "invalid_state", "This payment settled on a network you no longer use for payouts. Refund it from the wallet that received it, outside Solverr."),
    );
  }
  const paymentId = request.paymentId ?? invoice.paidQuoteId;
  const payment = invoice.quotes.find((quote) => quote.id === paymentId && quote.oneclickStatus === "SUCCESS");
  if (!payment) return refused("no_payment", new ApiError(404, "not_found", "No completed payment with this id on the invoice.", "payment_id"));

  const settled = BigInt(invoice.amountOutBase);
  const previous = refunds.filter((refund) => refund.quoteId === payment.id && refund.status !== "failed" && refund.status !== "canceled");
  const refunded = previous.reduce((sum, refund) => sum + toBaseUnits(refund.amount, invoice.destinationDecimals), 0n);
  const remaining = settled - refunded;
  if (request.amount) {
    const tooPrecise = precisionError(request.amount, invoice.destinationDecimals, invoice.destinationSymbol);
    if (tooPrecise) return refused("precision", tooPrecise);
  }
  const amount = request.amount ? toBaseUnits(request.amount, invoice.destinationDecimals) : remaining;
  if (amount <= 0n || amount > remaining) {
    /** Nothing left because a refund is still open: say so, since the merchant may only need to send or cancel that one. */
    const open = remaining <= 0n ? previous.find((refund) => refund.status === "pending" || refund.status === "processing") : undefined;
    if (open) {
      return refused("refund_open", new ApiError(409, "invalid_state", `Refund ${open.id} of this payment is still open. Send or cancel it in Refunds & payouts before refunding again.`));
    }
    const left = formatBaseUnits(remaining > 0n ? remaining : 0n, invoice.destinationDecimals);
    return refused(remaining <= 0n ? "refunded" : "amount", new ApiError(409, "invalid_state", `At most ${left} ${invoice.destinationSymbol} of this payment can still be refunded.`, "amount"));
  }
  return { ok: true, payment, amount, refunded };
}

/** Refunds a payment of a live invoice from the settlement coin to the payer's refund address in the coin they paid, as `checkRefund`
    allows; demo store (test mode) invoices move no money, so they have nothing to refund. */
export async function createRefund(merchant: Merchant, input: z.infer<typeof createRefundSchema>): Promise<Transfer> {
  return getDb().$transaction(async (tx) => {
    /** Concurrent refunds of one invoice take turns, so together they cannot exceed the remaining amount; another business's invoice is not locked. */
    await lockMerchantInvoice(tx, input.invoice_id, merchant.id);
    const invoice = await tx.invoice.findFirst({ where: { id: input.invoice_id, merchantId: merchant.id, mode: "live" }, include: { quotes: true } });
    if (!invoice) throw new ApiError(404, "not_found", "No invoice with this id.", "invoice_id");
    const refunds = await tx.transfer.findMany({ where: { quoteId: { in: invoice.quotes.map((quote) => quote.id) }, kind: "refund" } });
    const check = checkRefund(invoice, merchant.payoutChain, refunds, { paymentId: input.payment_id, amount: input.amount });
    if (!check.ok) throw check.error;
    const { payment, amount, refunded } = check;

    const refund = await create(tx, merchant, "refund", {
      amount: formatBaseUnits(amount, invoice.destinationDecimals),
      sourceAsset: invoice.destinationAsset,
      destinationAsset: payment.originAsset,
      recipient: payment.refundTo,
      invoiceId: invoice.id,
      quoteId: payment.id,
    });
    /** Only the payment that settled the invoice funded its credits and its split payouts; an extra payment did neither. */
    if (payment.id === invoice.paidQuoteId) {
      if (invoice.creditAccountId && invoice.creditedAt) {
        await takeBackTopUpCredits(tx, { invoiceId: invoice.id, creditAccountId: invoice.creditAccountId, credited: invoice.amount }, refunded + amount, BigInt(invoice.amountOutBase), refund.id);
      }
      await resizeSplitPayouts(tx, invoice.id);
    }
    return refund;
  });
}

/** Swaps Earn vault shares back to USDC on the same chain, into the merchant's own payout wallet; one open withdrawal per vault. */
export async function createEarnWithdrawal(merchant: Merchant, vaultAssetId: string, amount: string): Promise<Transfer> {
  const vault = await findToken(vaultAssetId);
  if (!vault || !isEarnAsset(vaultAssetId)) throw new ApiError(400, "invalid_request", "This is not an Earn vault coin.", "asset_id");
  const chain = chainForToken(vault);
  if (!merchant.payoutAddress || !chain || chain.id !== merchant.payoutChain) throw new ApiError(409, "invalid_state", "The vault shares must be on your payout network.");
  const usdc = (await listTokens()).find((token) => token.symbol === "USDC" && chainForToken(token)?.id === chain.id);
  if (!usdc) throw new ApiError(409, "invalid_state", `USDC is not available on ${chain.name}.`);
  const recipient = merchant.payoutAddress;
  return getDb().$transaction(async (tx) => {
    /** Concurrent requests take turns, so the same shares are never withdrawn twice. */
    await lockMerchant(tx, merchant.id);
    const open = await tx.transfer.findFirst({ where: { merchantId: merchant.id, kind: "withdrawal", sourceAsset: vault.assetId, status: { in: ["pending", "processing"] } } });
    if (open) throw new ApiError(409, "invalid_state", "A withdrawal from this vault is already in progress. Approve it or wait for it to finish in Refunds & payouts.");
    return tx.transfer.create({
      data: {
        id: newId("pay"),
        merchantId: merchant.id,
        kind: "withdrawal",
        amount,
        sourceAsset: vault.assetId,
        destinationAsset: usdc.assetId,
        recipient,
      },
    });
  });
}

type PayoutInput = z.infer<typeof createPayoutSchema>;

/** Checks the recipient and that the settlement coin can express the amount exactly (≥ 1 base unit, no extra decimals);
    returns it without trailing zeros like refunds ("0.50" → "0.5"), so the amount stored is the amount sent. */
async function checkedPayoutAmount(merchant: Merchant, input: PayoutInput): Promise<string> {
  await assertRecipient(input.asset_id, input.recipient);
  const source = await findToken(merchant.settlementAsset);
  if (!source) throw new ApiError(409, "invalid_state", "The coin you receive is no longer supported. Choose another one in Settings.");
  const tooPrecise = precisionError(input.amount, source.decimals, source.symbol);
  if (tooPrecise) throw tooPrecise;
  const base = toBaseUnits(input.amount, source.decimals);
  if (base === 0n) {
    throw new ApiError(400, "invalid_request", `amount is smaller than the smallest unit of ${source.symbol} (${source.decimals} decimals).`, "amount");
  }
  return formatBaseUnits(base, source.decimals);
}

/** The refusal for an amount with more decimals than the coin has, which would otherwise be cut off without notice; null when it fits. */
function precisionError(amount: string, decimals: number, symbol: string): ApiError | null {
  if ((amount.split(".")[1] ?? "").length <= decimals) return null;
  return new ApiError(400, "invalid_request", `amount can have at most ${decimals} decimals, the precision of ${symbol}.`, "amount");
}

function payoutData(merchant: Merchant, input: PayoutInput, amount: string, batchId?: string): TransferData {
  return { amount, sourceAsset: merchant.settlementAsset, destinationAsset: input.asset_id, recipient: input.recipient, batchId };
}

export async function createPayout(merchant: Merchant, input: PayoutInput): Promise<Transfer> {
  const amount = await checkedPayoutAmount(merchant, input);
  return create(getDb(), merchant, "payout", payoutData(merchant, input, amount));
}

/** Checks every row, then creates all together, so a failure never leaves half a batch. Errors name `rowNumbers[index]`
    (or the 1-based position) and set `param` to `payouts.<index>.<field>`, as schema errors do. */
export async function createPayoutBatch(merchant: Merchant, inputs: PayoutInput[], rowNumbers?: number[]): Promise<{ batchId: string; payouts: Transfer[] }> {
  const amounts: string[] = [];
  for (const [index, input] of inputs.entries()) {
    amounts.push(
      await checkedPayoutAmount(merchant, input).catch((error: unknown) => {
        if (!(error instanceof ApiError)) throw error;
        const param = error.param ? `payouts.${index}.${error.param}` : undefined;
        throw new ApiError(error.status, error.type, `Row ${rowNumbers?.[index] ?? index + 1}: ${error.message}`, param);
      }),
    );
  }
  const batchId = newId("bat");
  const rows = inputs.map((input, index) => transferRow(merchant, "payout", payoutData(merchant, input, amounts[index], batchId)));
  /** One INSERT creates every row or none; the result is put back in input order. */
  const created = new Map((await getDb().transfer.createManyAndReturn({ data: rows })).map((transfer) => [transfer.id, transfer]));
  return { batchId, payouts: rows.map((row) => created.get(row.id)!) };
}
