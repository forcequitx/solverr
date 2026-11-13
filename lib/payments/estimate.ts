import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { getDb } from "@/lib/db";
import { isRefusal } from "@/lib/oneclick/client";
import { isConfidentialRefusal } from "@/lib/oneclick/confidentiality";
import { paymentNetwork } from "@/lib/oneclick/network";
import type { OneClickToken, QuoteRequest } from "@/lib/oneclick/types";
import { assertQuotable, buildQuoteRequest, privatePaymentRefused, QUOTE_TTL_MS, quoteRejection, refusalMinimum, resolveOrigin } from "@/lib/payments/quote";

const MAX_ESTIMATES = 5;

export const estimateSchema = z.strictObject({
  origin_assets: z.array(z.string().min(1).max(200)).min(1).max(MAX_ESTIMATES),
  /** Without it, each coin is checked only for whether it can pay and what it costs. */
  refund_address: z.string().trim().min(1).max(200).optional(),
});

export type Estimate =
  | { asset_id: string; ok: true; amount_in: string; amount_in_base: string; amount_in_usd: string | null }
  | { asset_id: string; ok: false; reason: string; minimum_usd?: string; temporary?: true };

/** Dry quotes (nothing reserved) for up to MAX_ESTIMATES coins, to rank a payer's coins by cost or check one before a refund address. */
export async function estimatePayments(invoiceId: string, input: z.infer<typeof estimateSchema>): Promise<Estimate[]> {
  const invoice = await getDb().invoice.findUnique({ where: { id: invoiceId }, include: { merchant: true } });
  if (!invoice) throw new ApiError(404, "not_found", "No invoice with this id.", "id");
  /** The same refusals as creating an address, so a coin is never priced for an invoice that address creation then refuses. */
  assertQuotable(invoice);
  const network = paymentNetwork(invoice.mode);
  const deadline = new Date(Date.now() + QUOTE_TTL_MS);
  const refundAddress = input.refund_address ?? null;

  return Promise.all(
    [...new Set(input.origin_assets)].map(async (assetId): Promise<Estimate> => {
      let origin: OneClickToken | undefined;
      let request: QuoteRequest | undefined;
      try {
        origin = await resolveOrigin(assetId, refundAddress);
        request = await buildQuoteRequest(invoice, origin, refundAddress, true, deadline);
        const response = await network.estimate(request);
        return { asset_id: assetId, ok: true, amount_in: response.quote.amountInFormatted, amount_in_base: response.quote.amountIn, amount_in_usd: response.quote.amountInUsd ?? null };
      } catch (error) {
        /** A refused private payment, or a payout network the business no longer uses, concerns every coin, so the whole estimate fails
            with it instead of one coin. */
        if (error instanceof ApiError) {
          if (error.type === "quote_unavailable" || error.code === "payout_changed") throw error;
          return { asset_id: assetId, ok: false, reason: error.message };
        }
        if (isRefusal(error)) {
          if (request?.confidentiality && isConfidentialRefusal(error)) throw privatePaymentRefused();
          if (!origin) return { asset_id: assetId, ok: false, reason: "Not available right now." };
          const minimum = await refusalMinimum(error, origin, invoice);
          return {
            asset_id: assetId,
            ok: false,
            reason: (await quoteRejection(error, origin, invoice)).message,
            ...(minimum ? { minimum_usd: String(minimum) } : {}),
          };
        }
        return { asset_id: assetId, ok: false, reason: "The payment network did not answer. Try again.", temporary: true };
      }
    }),
  );
}
