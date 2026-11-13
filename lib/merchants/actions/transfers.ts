"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { rateLimit } from "@/lib/api/rate-limit";
import { type ActionResult, editable, fail, ID } from "@/lib/merchants/actions/shared";
import { cancelTransfer, prepareTransfer, reportTransferTx } from "@/lib/transfers/execute";
import { createPayoutBatch, createPayoutSchema, createRefund, createRefundSchema } from "@/lib/transfers/transfers";

/** Creates a pending refund of a paid invoice, or of one of its payments. */
export async function createRefundAction(merchantId: string, invoiceId: string, paymentId?: string): Promise<ActionResult<{ id: string }>> {
  try {
    const { merchant } = await editable(merchantId);
    const refund = await createRefund(merchant, createRefundSchema.parse({ invoice_id: invoiceId, payment_id: paymentId }));
    revalidatePath("/dashboard/transfers");
    return { ok: true, id: refund.id };
  } catch (error) {
    return fail(error);
  }
}

/** Creates one payout per CSV row: `recipient,asset_id,amount`. All rows are validated before any is created. */
export async function createPayoutsAction(merchantId: string, csv: string): Promise<ActionResult<{ count: number; batchId: string }>> {
  try {
    const { merchant } = await editable(merchantId);
    /** Errors name the line number in the pasted text, counting blank lines and the header. */
    const lines = csv
      .split(/\r?\n/)
      .map((line, index) => ({ text: line.trim(), number: index + 1 }))
      .filter(({ text }) => text && !/^recipient\s*,/i.test(text));
    const rows = lines.map(({ text, number }) => {
      const cells = text.split(",").map((cell) => cell.trim());
      if (cells.length !== 3) throw new ApiError(400, "invalid_request", `Row ${number}: use recipient,asset_id,amount, with no commas inside the amount.`);
      const [recipient, asset_id, amount] = cells;
      const parsed = createPayoutSchema.safeParse({ recipient, asset_id, amount });
      if (!parsed.success) throw new ApiError(400, "invalid_request", `Row ${number}: ${parsed.error.issues[0]?.message}`);
      return parsed.data;
    });
    if (rows.length === 0) throw new ApiError(400, "invalid_request", "Add at least one row: recipient,asset_id,amount");
    if (rows.length > 200) throw new ApiError(400, "invalid_request", "A batch can have at most 200 rows.");
    const { batchId } = await createPayoutBatch(
      merchant,
      rows,
      lines.map(({ number }) => number),
    );
    revalidatePath("/dashboard/transfers");
    return { ok: true, count: rows.length, batchId };
  } catch (error) {
    return fail(error);
  }
}

/** Transfer preparations per business per minute; each one can ask 1Click for a quote, whose request budget checkouts share. */
const PREPARES_PER_MINUTE = 10;

/** Prepares a transfer to send; `sendAgain` confirms that a transfer prepared before was not sent. */
export async function prepareTransferAction(merchantId: string, transferId: string, sendAgain = false) {
  try {
    const { merchant } = await editable(merchantId);
    await rateLimit(`transfer-prepare:${merchant.id}`, PREPARES_PER_MINUTE, 60_000);
    const prepared = await prepareTransfer(ID.parse(transferId), merchant.id, z.boolean().parse(sendAgain));
    /** The layout scope covers the transfer's own page, whose cancel must carry the deposit address just prepared. */
    revalidatePath("/dashboard/transfers", "layout");
    return { ok: true as const, ...prepared };
  } catch (error) {
    return fail(error);
  }
}

/** Cancels a transfer that was not sent. `depositAddress` is the one the merchant's page showed when confirming,
    so the cancel counts only if nobody prepared the transfer again since. */
export async function cancelTransferAction(merchantId: string, transferId: string, depositAddress: string | null): Promise<ActionResult> {
  try {
    const { merchant } = await editable(merchantId);
    await cancelTransfer(ID.parse(transferId), merchant.id, { depositAddress: z.string().max(200).nullable().parse(depositAddress) });
    revalidatePath("/dashboard/transfers", "layout");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Records the transaction the merchant's wallet sent for a transfer; `paidTo` is the address the wallet paid, when it is known. */
export async function reportTransferAction(merchantId: string, transferId: string, txHash: string, paidTo?: string): Promise<ActionResult> {
  try {
    const { merchant } = await editable(merchantId);
    const address = z.string().min(1).max(200).optional().parse(paidTo);
    await reportTransferTx(ID.parse(transferId), merchant.id, z.string().trim().min(8).max(200).parse(txHash), address);
    /** The layout scope covers the transfer's own page, where it was sent from. */
    revalidatePath("/dashboard/transfers", "layout");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
