"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createApiKey } from "@/lib/api/keys";
import { ApiError } from "@/lib/api/errors";
import { rateLimit } from "@/lib/api/rate-limit";
import { assertRecentSignIn } from "@/lib/auth/recent-sign-in";
import { encryptSecret } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { type ActionResult, editable, fail, ID, ownerOnly } from "@/lib/merchants/actions/shared";
import { alertOwner } from "@/lib/merchants/alerts";
import { lockMerchant } from "@/lib/row-locks";
import { sendDelivery } from "@/lib/webhooks/deliver";
import { ROTATION_OVERLAP_MS, webhookEndpoint, WEBHOOKS_OFF_MESSAGE } from "@/lib/webhooks/endpoint";
import { enqueueWebhook } from "@/lib/webhooks/events";
import { newWebhookSecret } from "@/lib/webhooks/signature";
import { webhookUrlProblem } from "@/lib/webhooks/url";

/** API keys and the webhook move real money, so only the owner manages them. */
export async function createApiKeyAction(merchantId: string): Promise<ActionResult<{ secret: string }>> {
  try {
    const { merchant, user } = await ownerOnly("Only the owner can create API keys.", merchantId);
    if (!merchant.payoutVerifiedAt) throw new ApiError(400, "invalid_request", "Verify your payout wallet before creating a key.");
    /** A key acts for the business for good, so a stolen or forgotten session alone must not mint one. */
    assertRecentSignIn(user, "create the API key");
    const { secret } = await createApiKey(merchant.id);
    await alertOwner(merchant, "access_changed", `A new API key ending in ${secret.slice(-4)} was created. If you did not do this, revoke it in Developers.`, "/dashboard/developers");
    revalidatePath("/dashboard/developers");
    return { ok: true, secret };
  } catch (error) {
    return fail(error);
  }
}

export async function revokeApiKeyAction(merchantId: string, keyId: string): Promise<ActionResult> {
  try {
    const { merchant } = await ownerOnly("Only the owner can revoke API keys.", merchantId);
    await getDb().apiKey.updateMany({ where: { id: ID.parse(keyId), merchantId: merchant.id, revokedAt: null }, data: { revokedAt: new Date() } });
    revalidatePath("/dashboard/developers");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Saves the webhook URL and turns webhooks back on after a 410 Gone. Returns a new secret (shown once) when there was none or `rotate` is set;
    a rotated secret keeps signing beside the new one for ROTATION_OVERLAP_MS. */
export async function setWebhookAction(merchantId: string, input: { url: string; rotate?: boolean }): Promise<ActionResult<{ secret?: string }>> {
  try {
    const { merchant, user } = await ownerOnly("Only the owner can change the webhook.", merchantId);
    const { url, rotate } = z
      .strictObject({ url: z.string().trim().max(2000, "The webhook URL can be at most 2000 characters."), rotate: z.boolean().optional() })
      .parse(input);
    /** Where events go and the secret that signs them decide what the business's server trusts, so they need a recent sign-in. */
    const endpointChanged = (url || null) !== merchant.webhookUrl || !!rotate;
    if (endpointChanged) assertRecentSignIn(user, "change the webhook");
    if (url) {
      const problem = await webhookUrlProblem(url);
      if (problem) throw new ApiError(400, "invalid_request", problem);
    }
    /** The secret is read again under the merchant lock, so two saves at once cannot each show a secret only one of them stored. */
    const secret = await getDb().$transaction(async (tx) => {
      await lockMerchant(tx, merchant.id);
      const { webhookSecretEnc: currentEnc } = await tx.merchant.findUniqueOrThrow({ where: { id: merchant.id }, select: { webhookSecretEnc: true } });
      const created = url && (rotate || !currentEnc) ? newWebhookSecret() : undefined;
      const rotated = !!created && !!currentEnc;
      await tx.merchant.update({
        where: { id: merchant.id },
        /** An empty URL removes the endpoint and its secrets; without a new secret the stored one is kept. */
        data: !url
          ? { webhookUrl: null, webhookSecretEnc: null, webhookPreviousSecretEnc: null, webhookPreviousSecretUntil: null, webhookDisabledAt: null, webhookPausedUntil: null }
          : {
              webhookUrl: url,
              webhookDisabledAt: null,
              webhookPausedUntil: null,
              ...(created ? { webhookSecretEnc: encryptSecret(created) } : {}),
              ...(rotated ? { webhookPreviousSecretEnc: currentEnc, webhookPreviousSecretUntil: new Date(Date.now() + ROTATION_OVERLAP_MS) } : {}),
            },
      });
      /** Without an endpoint the waiting deliveries can never succeed, so they end now instead of retrying for days and alerting. */
      if (!url) {
        await tx.webhookDelivery.updateMany({ where: { merchantId: merchant.id, status: "pending" }, data: { status: "failed", nextRetryAt: null, responseCode: null, lastError: "The webhook URL was removed." } });
      }
      return created;
    });
    if (endpointChanged) {
      const message = url ? `The webhook endpoint was changed to ${url}${rotate ? " and its signing secret was replaced" : ""}.` : "The webhook endpoint was removed.";
      await alertOwner(merchant, "access_changed", `${message} If you did not do this, check Developers.`, "/dashboard/developers");
    }
    revalidatePath("/dashboard/developers");
    return { ok: true, secret };
  } catch (error) {
    return fail(error);
  }
}

/** Queues a test.ping event for the saved webhook URL; the worker delivers it like any other event, to check the endpoint receives and verifies it. */
export async function sendPingWebhookAction(merchantId: string): Promise<ActionResult> {
  try {
    const { merchant } = await editable(merchantId);
    await rateLimit(`webhook-test:${merchant.id}`, 10, 60_000);
    if (merchant.webhookDisabledAt) throw new ApiError(400, "invalid_request", WEBHOOKS_OFF_MESSAGE);
    if (!webhookEndpoint(merchant, "live")) throw new ApiError(400, "invalid_request", "Save a webhook URL first.");
    await getDb().$transaction((tx) => enqueueWebhook(tx, merchant, "live", "test.ping", { message: "This is a ping event from Solverr." }));
    revalidatePath("/dashboard/developers");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Sends one logged webhook event again right away. */
export async function resendDeliveryAction(merchantId: string, deliveryId: string): Promise<ActionResult> {
  try {
    const { merchant } = await editable(merchantId);
    await rateLimit(`webhook-resend:${merchant.id}`, 10, 60_000);
    /** As for a ping: with webhooks stopped or no URL, a failed resend would put the event back on the retry schedule. */
    if (merchant.webhookDisabledAt) throw new ApiError(400, "invalid_request", WEBHOOKS_OFF_MESSAGE);
    if (!webhookEndpoint(merchant, "live")) throw new ApiError(400, "invalid_request", "Save a webhook URL first.");
    const delivery = await getDb().webhookDelivery.findFirst({ where: { id: ID.parse(deliveryId), merchantId: merchant.id }, include: { merchant: true } });
    if (!delivery) throw new ApiError(400, "invalid_request", "This delivery no longer exists. Reload the page.");
    const outcome = await sendDelivery(delivery);
    revalidatePath("/dashboard/developers");
    return outcome.ok ? { ok: true } : { ok: false, error: outcome.error ?? "The endpoint did not accept the event." };
  } catch (error) {
    return fail(error);
  }
}
