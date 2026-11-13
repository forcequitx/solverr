import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma, type CreditAccount, type Merchant } from "@/generated/prisma/client";
import { ApiError } from "@/lib/api/errors";
import { getDb } from "@/lib/db";
import { newId, randomToken } from "@/lib/ids";
import { invoiceData } from "@/lib/invoices/create";
import { serializeInvoice } from "@/lib/invoices/serialize";

const AMOUNT = z
  .string()
  .regex(/^\d{1,9}(\.\d{1,6})?$/, 'amount must be a decimal string, such as "0.05".')
  .refine((value) => Number(value) > 0, "amount must be greater than 0.");

const CREDIT_TOKEN_PATTERN = /^solverr_credit_[1-9A-HJ-NP-Za-km-z]{32}$/;

export const topupSchema = z.strictObject({
  amount: AMOUNT.refine((value) => /^\d+(\.\d{1,2})?$/.test(value), "Top-ups use at most 2 decimals."),
  currency: z.literal("USD", { error: "Credits are kept in USD." }),
  credit_account_id: z.string().min(1).optional(),
});

export const chargeSchema = z.strictObject({
  token: z.string().regex(CREDIT_TOKEN_PATTERN, "token must be a solverr_credit_… token."),
  amount: AMOUNT,
  /** Credits are kept in USD; a charge priced in another currency is refused instead of deducting the wrong unit. */
  currency: z.literal("USD", { error: "Credit balances are in USD; price this route in USD to charge credits." }).optional(),
  description: z.string().max(200).optional(),
});

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function serializeCreditAccount(account: CreditAccount, token?: string) {
  return { id: account.id, object: "credit_account", ...(token ? { token } : {}), balance: account.balance.toFixed(6), currency: "USD" };
}

/** Creates (or reuses) a credit account and a live invoice whose payment adds its amount to the balance. */
export async function topUp(merchant: Merchant, input: z.infer<typeof topupSchema>) {
  const db = getDb();
  let existing: CreditAccount | null = null;
  if (input.credit_account_id) {
    existing = await db.creditAccount.findFirst({ where: { id: input.credit_account_id, merchantId: merchant.id } });
    if (!existing) throw new ApiError(404, "not_found", "No credit account with this id.", "credit_account_id");
  }
  const accountId = existing?.id ?? newId("cra");
  const token = existing ? undefined : `solverr_credit_${randomToken(32)}`;

  /** The invoice is priced first, so a failed price leaves no account behind; the account and invoice are then saved together. */
  const data = await invoiceData(merchant, "live", { amount: input.amount, currency: "USD", description: "Agent credits top-up" }, { creditAccountId: accountId });
  const { account, invoice } = await db.$transaction(async (tx) => ({
    account: existing ?? (await tx.creditAccount.create({ data: { id: accountId, merchantId: merchant.id, tokenHash: hashToken(token!) } })),
    invoice: await tx.invoice.create({ data }),
  }));
  return { credit_account: serializeCreditAccount(account, token), invoice: serializeInvoice(invoice) };
}

/** Deducts `amount` from the token's balance atomically; fails when the balance is too low. */
export async function charge(merchant: Merchant, input: z.infer<typeof chargeSchema>) {
  const db = getDb();
  return db.$transaction(async (tx) => {
    const account = await tx.creditAccount.findUnique({ where: { tokenHash: hashToken(input.token) } });
    if (!account || account.merchantId !== merchant.id) {
      throw new ApiError(404, "not_found", "This credit token is not valid for your account.", "token");
    }
    const amount = new Prisma.Decimal(input.amount);
    const updated = await tx.creditAccount.updateMany({ where: { id: account.id, balance: { gte: amount } }, data: { balance: { decrement: amount } } });
    if (updated.count === 0) throw new ApiError(409, "insufficient_credit", "This credit balance is too low. Top it up to continue.");
    const usage = await tx.creditUsage.create({ data: { id: newId("cru"), creditAccountId: account.id, amount, description: input.description ?? null } });
    const after = await tx.creditAccount.findUniqueOrThrow({ where: { id: account.id } });
    return { id: usage.id, object: "credit_charge", amount: amount.toFixed(6), balance: after.balance.toFixed(6), currency: "USD" };
  });
}

/** Takes back a refunded top-up's credit share in the refund's transaction (refused when spent). The share is figured on `totalRefundedBase`
    (this refund included) less what earlier refunds took, so rounding up never takes back more than was credited. */
export async function takeBackTopUpCredits(
  tx: Prisma.TransactionClient,
  topUp: { invoiceId: string; creditAccountId: string; credited: Prisma.Decimal },
  totalRefundedBase: bigint,
  settledBase: bigint,
  refundTransferId: string,
): Promise<void> {
  const target = Prisma.Decimal.min(
    topUp.credited,
    topUp.credited.mul(totalRefundedBase.toString()).div(settledBase.toString()).toDecimalPlaces(6, Prisma.Decimal.ROUND_UP),
  );
  const earlierRefunds = await tx.transfer.findMany({ where: { invoiceId: topUp.invoiceId, kind: "refund", id: { not: refundTransferId } }, select: { id: true } });
  const earlierTaken = await tx.creditUsage.aggregate({
    where: { creditAccountId: topUp.creditAccountId, refundedAt: null, refundTransferId: { in: earlierRefunds.map((refund) => refund.id) } },
    _sum: { amount: true },
  });
  const share = Prisma.Decimal.max(0, target.minus(earlierTaken._sum.amount ?? 0));
  if (share.isZero()) return;
  const taken = await tx.creditAccount.updateMany({ where: { id: topUp.creditAccountId, balance: { gte: share } }, data: { balance: { decrement: share } } });
  if (taken.count === 0) {
    const account = await tx.creditAccount.findUniqueOrThrow({ where: { id: topUp.creditAccountId } });
    throw new ApiError(409, "invalid_state", `This refund takes back ${share.toFixed(6)} USD of credits, but the agent has only ${account.balance.toFixed(6)} USD left. Refund a smaller amount.`, "amount");
  }
  await tx.creditUsage.create({
    data: { id: newId("cru"), creditAccountId: topUp.creditAccountId, amount: share, description: `Refund of top-up ${topUp.invoiceId}`, refundTransferId },
  });
}

/** Restores credits a failed or canceled top-up refund took back, in the caller's transaction so status and credits change together. */
export async function restoreTopUpCredits(tx: Prisma.TransactionClient, refundTransferId: string): Promise<void> {
  const usage = await tx.creditUsage.findUnique({ where: { refundTransferId } });
  if (!usage) return;
  const restored = await tx.creditUsage.updateMany({ where: { id: usage.id, refundedAt: null }, data: { refundedAt: new Date() } });
  if (restored.count === 0) return;
  await tx.creditAccount.update({ where: { id: usage.creditAccountId }, data: { balance: { increment: usage.amount } } });
}

/** Gives a charge back to its credit account, at most once; the paywall calls it when the request the charge paid for failed. */
export async function refundCharge(merchant: Merchant, chargeId: string) {
  const db = getDb();
  return db.$transaction(async (tx) => {
    /** A row a top-up refund took back is not a charge: giving it back would leave the agent with both the money and the credits. */
    const usage = await tx.creditUsage.findFirst({ where: { id: chargeId, refundTransferId: null, creditAccount: { merchantId: merchant.id } } });
    if (!usage) throw new ApiError(404, "not_found", "No credit charge with this id.", "id");
    const refunded = await tx.creditUsage.updateMany({ where: { id: usage.id, refundedAt: null }, data: { refundedAt: new Date() } });
    if (refunded.count === 0) throw new ApiError(409, "invalid_state", "This charge was already refunded.");
    const account = await tx.creditAccount.update({ where: { id: usage.creditAccountId }, data: { balance: { increment: usage.amount } } });
    return { id: usage.id, object: "credit_charge", amount: usage.amount.toFixed(6), refunded: true, balance: account.balance.toFixed(6), currency: "USD" };
  });
}
