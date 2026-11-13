import { cancelTransferRoute } from "@/lib/transfers/route-handlers";

/** Cancels a refund that was not sent; its amount can then be refunded again. */
export const POST = cancelTransferRoute("refund");
