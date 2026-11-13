import { authenticateMerchant } from "@/lib/api/auth";
import { readJson } from "@/lib/api/body";
import { handleRoute, parseInput } from "@/lib/api/errors";
import { withIdempotency } from "@/lib/api/idempotency";
import { rateLimit } from "@/lib/api/rate-limit";
import { charge, chargeSchema } from "@/lib/credits/credits";

/** Paywall middleware charges an agent's credit token per call. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const { merchant, apiKeyId } = await authenticateMerchant(request);
    await rateLimit(`credits:${apiKeyId}`, 600, 60_000);
    const { raw, data } = await readJson(request);
    return withIdempotency(request, merchant.id, raw, async () => ({ status: 200, body: await charge(merchant, parseInput(chargeSchema, data)) }));
  });
}
