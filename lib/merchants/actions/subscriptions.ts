"use server";

import { revalidatePath } from "next/cache";
import { ApiError } from "@/lib/api/errors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getDb } from "@/lib/db";
import { type ActionResult, editable, fail, ID, PAYOUT_WALLET_REQUIRED } from "@/lib/merchants/actions/shared";
import { createSubscription, createSubscriptionSchema } from "@/lib/subscriptions/subscriptions";

export async function createSubscriptionAction(
  merchantId: string,
  input: { customer_email: string; amount: string; currency: string; interval: string; description?: string },
): Promise<ActionResult> {
  try {
    const { merchant } = await editable(merchantId);
    if (!merchant.payoutVerifiedAt) throw new ApiError(400, "invalid_request", PAYOUT_WALLET_REQUIRED);
    await rateLimit(`subscriptions:${merchant.id}`, 60, 60_000);
    await createSubscription(merchant, createSubscriptionSchema.parse({ ...input, description: input.description?.trim() || undefined }));
    revalidatePath("/dashboard/subscriptions");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function cancelSubscriptionAction(merchantId: string, subscriptionId: string): Promise<ActionResult> {
  try {
    const { merchant } = await editable(merchantId);
    await getDb().subscription.updateMany({ where: { id: ID.parse(subscriptionId), merchantId: merchant.id }, data: { status: "canceled" } });
    revalidatePath("/dashboard/subscriptions");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
