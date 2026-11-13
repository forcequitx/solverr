import { z } from "zod";
import { ApiError, handleRoute, NO_STORE, parseInput } from "@/lib/api/errors";
import { getSessionUser, OTHER_BUSINESS_MESSAGE, selectedMembership } from "@/lib/auth/session";
import { ASSET_ID, ID } from "@/lib/merchants/actions/shared";
import { merchantSettlementCheck } from "@/lib/merchants/settlement-check";

/** Dashboard only: whether NEAR Intents takes small payments into `asset_id` on the payout network of `merchant_id`, the business
    the page shows; refused with 409 unless it is still the selected business. */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const user = await getSessionUser();
    const membership = user ? await selectedMembership(user.id) : null;
    if (!membership) throw new ApiError(401, "authentication_failed", "Sign in to the dashboard first.");
    const { merchant_id, asset_id } = parseInput(z.object({ merchant_id: ID, asset_id: ASSET_ID }), Object.fromEntries(new URL(request.url).searchParams));
    if (membership.merchantId !== merchant_id) throw new ApiError(409, "invalid_state", OTHER_BUSINESS_MESSAGE);
    return Response.json({ check: await merchantSettlementCheck(membership.merchant, asset_id) }, { headers: NO_STORE });
  });
}
