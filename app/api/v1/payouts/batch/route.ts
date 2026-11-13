import { z } from "zod";
import { authenticateMerchant } from "@/lib/api/auth";
import { readJson } from "@/lib/api/body";
import { handleRoute, parseInput } from "@/lib/api/errors";
import { withIdempotency } from "@/lib/api/idempotency";
import { rateLimit } from "@/lib/api/rate-limit";
import { serializeTransfer } from "@/lib/transfers/serialize";
import { createPayoutBatch, createPayoutSchema } from "@/lib/transfers/transfers";

const batchSchema = z.strictObject({ payouts: z.array(createPayoutSchema).min(1).max(200) });

/** Creates up to 200 pending payouts in one batch; every row is checked before any payout is created. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const { merchant, apiKeyId } = await authenticateMerchant(request);
    /** Its own bucket: in the shared one, a sync job reading the API every few seconds could never create a batch. */
    await rateLimit(`payout-batch:${apiKeyId}`, 20, 60_000);
    const { raw, data } = await readJson(request);
    return withIdempotency(request, merchant.id, raw, async () => {
      const { batchId, payouts } = await createPayoutBatch(merchant, parseInput(batchSchema, data).payouts);
      return { status: 201, body: { object: "payout_batch", id: batchId, data: payouts.map(serializeTransfer) } };
    });
  });
}
