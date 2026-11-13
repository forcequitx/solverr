"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getDb } from "@/lib/db";
import { type ActionResult, editable, fail, ID, PAYOUT_WALLET_REQUIRED } from "@/lib/merchants/actions/shared";
import { createPaymentLink, createPaymentLinkSchema } from "@/lib/payment-links/links";

/** Payment links one business may create per minute from the dashboard, matching the API's shared per-key limit. */
const LINKS_PER_MINUTE = 60;

export async function createPaymentLinkAction(
  merchantId: string,
  input: { title: string; amount?: string; currency: string; redirect_url?: string },
): Promise<ActionResult<{ id: string }>> {
  try {
    const { merchant, mode } = await editable(merchantId);
    if (!merchant.payoutVerifiedAt) throw new ApiError(400, "invalid_request", PAYOUT_WALLET_REQUIRED);
    await rateLimit(`links:${merchant.id}`, LINKS_PER_MINUTE, 60_000);
    const link = await createPaymentLink(
      merchant,
      mode,
      createPaymentLinkSchema.parse({ ...input, amount: input.amount?.trim() || undefined, redirect_url: input.redirect_url?.trim() || undefined }),
    );
    revalidatePath("/dashboard/links");
    return { ok: true, id: link.id };
  } catch (error) {
    return fail(error);
  }
}

/** Turns a payment link on or off. */
export async function toggleLinkAction(merchantId: string, linkId: string, active: boolean): Promise<ActionResult> {
  try {
    const { merchant } = await editable(merchantId);
    await getDb().paymentLink.updateMany({ where: { id: ID.parse(linkId), merchantId: merchant.id }, data: { active: z.boolean().parse(active) } });
    revalidatePath("/dashboard/links");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
