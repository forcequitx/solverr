import { authenticateMerchant } from "@/lib/api/auth";
import { readJson } from "@/lib/api/body";
import { handleRoute, parseInput } from "@/lib/api/errors";
import { withIdempotency } from "@/lib/api/idempotency";
import { rateLimit } from "@/lib/api/rate-limit";
import { listTransfers } from "@/lib/transfers/route-handlers";
import { serializeTransfer } from "@/lib/transfers/serialize";
import { createPayout, createPayoutSchema } from "@/lib/transfers/transfers";

/** Creates a pending payout; the merchant approves it from their wallet at `sign_url`. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const { merchant, apiKeyId } = await authenticateMerchant(request);
    await rateLimit(`key:${apiKeyId}`, 60, 60_000);
    const { raw, data } = await readJson(request);
    return withIdempotency(request, merchant.id, raw, async () => ({
      status: 201,
      body: serializeTransfer(await createPayout(merchant, parseInput(createPayoutSchema, data))),
    }));
  });
}

export const GET = listTransfers("payout");
