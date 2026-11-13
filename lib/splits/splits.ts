import { z } from "zod";
import type { Invoice, Merchant, Prisma } from "@/generated/prisma/client";
import { ApiError } from "@/lib/api/errors";
import { isValidAddress } from "@/lib/chains/addresses";
import { getChain } from "@/lib/chains/registry";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/ids";
import { createAlert } from "@/lib/merchants/alerts";
import { formatBaseUnits, toBaseUnits } from "@/lib/money";
import { lockMerchant } from "@/lib/row-locks";
import { serializeTransfer } from "@/lib/transfers/serialize";
import { enqueueWebhook } from "@/lib/webhooks/events";

const MAX_TOTAL_BPS = 10_000;

export const splitRuleSchema = z.strictObject({
  label: z.string().trim().min(1, "Give the split a name.").max(60),
  recipient: z.string().trim().min(1).max(200),
  percent: z
    .string()
    .regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter a percentage such as 10 or 2.5.")
    .refine((value) => Number(value) > 0 && Number(value) <= 100, "The percentage must be between 0 and 100."),
});

/** Adds a split rule for the payout network after checking the recipient against it and the 100% total. */
export async function addSplitRule(merchant: Merchant, input: z.infer<typeof splitRuleSchema>): Promise<void> {
  const chain = merchant.payoutChain ? getChain(merchant.payoutChain) : undefined;
  if (!chain) throw new ApiError(400, "invalid_request", "Verify your payout wallet first. Splits are paid in the coin you receive, on that network.");
  if (!isValidAddress(chain.family, input.recipient)) throw new ApiError(400, "invalid_request", `The recipient must be a valid ${chain.name} address.`);
  const shareBps = Math.round(Number(input.percent) * 100);
  await getDb().$transaction(async (tx) => {
    /** Concurrent additions take turns, so together they cannot pass 100%. Only rules for the current network count, since payouts
        skip the others, so a split added for an earlier network can be added again with an address on this one. */
    await lockMerchant(tx, merchant.id);
    const existing = await tx.splitRule.aggregate({ where: { merchantId: merchant.id, chain: chain.id }, _sum: { shareBps: true } });
    if ((existing._sum.shareBps ?? 0) + shareBps > MAX_TOTAL_BPS) throw new ApiError(400, "invalid_request", "All splits together can be at most 100%.");
    await tx.splitRule.create({ data: { id: newId("spl"), merchantId: merchant.id, label: input.label, recipient: input.recipient, chain: chain.id, shareBps } });
  });
}

/** Creates one pending payout per split rule inside the transaction that marks a live invoice paid; a demo store (test mode) invoice
    moves no money, so it has none. Rules for another network are skipped: the same address can belong to someone else there. */
export async function createSplitPayouts(tx: Prisma.TransactionClient, invoice: Invoice): Promise<void> {
  if (invoice.mode !== "live") return;
  const rules = await tx.splitRule.findMany({ where: { merchantId: invoice.merchantId } });
  if (rules.length === 0) return;
  const chain = getChain(invoice.destinationChain);
  const batchId = newId("bat");
  const settled = BigInt(invoice.amountOutBase);
  const skipped: string[] = [];
  let created = 0;
  for (const rule of rules) {
    if (!chain || rule.chain !== chain.id) {
      skipped.push(rule.label);
      continue;
    }
    const share = (settled * BigInt(rule.shareBps)) / BigInt(MAX_TOTAL_BPS);
    if (share === 0n) continue;
    await tx.transfer.create({
      data: {
        id: newId("pay"),
        merchantId: invoice.merchantId,
        kind: "payout",
        invoiceId: invoice.id,
        batchId,
        splitShareBps: rule.shareBps,
        amount: formatBaseUnits(share, invoice.destinationDecimals),
        sourceAsset: invoice.destinationAsset,
        destinationAsset: invoice.destinationAsset,
        recipient: rule.recipient,
      },
    });
    created++;
  }
  if (created > 0) {
    const message =
      created === 1
        ? `1 split payout for payment ${invoice.id} is ready to approve in Refunds & payouts.`
        : `${created} split payouts for payment ${invoice.id} are ready to approve in Refunds & payouts.`;
    await createAlert(invoice.merchantId, "split_payouts", message, tx);
  }
  if (skipped.length > 0) {
    const network = chain?.name ?? invoice.destinationChain;
    const message = `No payout was created for payment ${invoice.id} for these splits, because they were added for another network than ${network}: ${skipped.join(", ")}. Add them again in Settings → Revenue splits with a ${network} address.`;
    await createAlert(invoice.merchantId, "split_payouts", message, tx);
  }
}

/** Resizes unprepared split payouts to their share of the settled amount less active refunds, on every refund change; a share at 0 waits
    while a refund is open, then is canceled. Prepared or sent payouts stay. The caller holds the invoice lock. */
export async function resizeSplitPayouts(tx: Prisma.TransactionClient, invoiceId: string): Promise<void> {
  const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { merchant: true } });
  if (!invoice.paidQuoteId) return;
  const splits = await tx.transfer.findMany({ where: { invoiceId, kind: "payout", splitShareBps: { not: null }, status: "pending", depositAddress: null } });
  if (splits.length === 0) return;
  const refunds = await tx.transfer.findMany({ where: { quoteId: invoice.paidQuoteId, kind: "refund", status: { notIn: ["failed", "canceled"] } }, select: { amount: true, status: true } });
  const refunded = refunds.reduce((sum, refund) => sum + toBaseUnits(refund.amount, invoice.destinationDecimals), 0n);
  const refundOpen = refunds.some((refund) => refund.status !== "completed");
  const kept = BigInt(invoice.amountOutBase) - refunded;
  let changed = 0;
  for (const split of splits) {
    const share = kept > 0n ? (kept * BigInt(split.splitShareBps!)) / BigInt(MAX_TOTAL_BPS) : 0n;
    const amount = formatBaseUnits(share, invoice.destinationDecimals);
    if ((share > 0n || refundOpen) && amount === split.amount) continue;
    const data =
      share > 0n || refundOpen ? { amount } : { status: "canceled" as const, failureReason: "The payment was refunded, so no share is left to pay.", nextPollAt: null };
    const { count } = await tx.transfer.updateMany({ where: { id: split.id, status: "pending", depositAddress: null, amount: split.amount }, data });
    if (count === 0) continue;
    changed++;
    if ("status" in data) {
      const canceled = await tx.transfer.findUniqueOrThrow({ where: { id: split.id } });
      await enqueueWebhook(tx, invoice.merchant, invoice.mode, "payout.canceled", { payout: serializeTransfer(canceled) });
    }
  }
  if (changed > 0) {
    const message = `Split payouts for payment ${invoice.id} now match what you keep after refunds. Split payouts already prepared or sent are not changed.`;
    await createAlert(invoice.merchantId, "split_payouts", message, tx);
  }
}
