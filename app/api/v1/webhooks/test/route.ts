import { authenticateMerchant } from "@/lib/api/auth";
import { readJson } from "@/lib/api/body";
import { ApiError, handleRoute } from "@/lib/api/errors";
import { withIdempotency } from "@/lib/api/idempotency";
import { rateLimit } from "@/lib/api/rate-limit";
import { getDb } from "@/lib/db";
import { webhookEndpoint, WEBHOOKS_OFF_MESSAGE } from "@/lib/webhooks/endpoint";
import { enqueueWebhook } from "@/lib/webhooks/events";

/** Queues a `test.ping` event to the business's webhook URL. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const { merchant, mode } = await authenticateMerchant(request);
    await rateLimit(`webhook-test:${merchant.id}`, 10, 60_000);
    const { raw } = await readJson(request);
    return withIdempotency(request, merchant.id, raw, async () => {
      if (merchant.webhookDisabledAt) throw new ApiError(409, "invalid_state", WEBHOOKS_OFF_MESSAGE);
      if (!webhookEndpoint(merchant, mode)) throw new ApiError(409, "invalid_state", "Set a webhook URL in the dashboard first.");
      await getDb().$transaction((tx) => enqueueWebhook(tx, merchant, mode, "test.ping", { message: "This is a ping event from Solverr." }));
      return { status: 202, body: { queued: true } };
    });
  });
}
