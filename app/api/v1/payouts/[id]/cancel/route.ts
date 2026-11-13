import { cancelTransferRoute } from "@/lib/transfers/route-handlers";

/** Cancels a payout that was not sent. */
export const POST = cancelTransferRoute("payout");
