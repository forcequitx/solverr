import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { ApiError, toApiError } from "@/lib/api/errors";
import { assertCanEdit, requireShownMerchant } from "@/lib/auth/session";

/** What every dashboard server action returns: success with its data, or a message to show. */
export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Row id passed from the dashboard (merchant, key, link, transfer, case and similar ids). */
export const ID = z.string().min(1).max(60);
/** 1Click asset ids are longer than row ids. */
export const ASSET_ID = z.string().min(1).max(200);
/** Refusal for creating something customers pay before a payout wallet is verified; only the owner can verify one. */
export const PAYOUT_WALLET_REQUIRED = "Customers cannot pay you until the owner verifies a payout wallet in Settings.";

/** Shows validation and ApiError messages; any other error becomes a safe message through toApiError. */
export function fail(error: unknown): { ok: false; error: string } {
  /** Next.js redirects (an expired session goes to sign-in) are thrown and must keep propagating. */
  unstable_rethrow(error);
  if (error instanceof z.ZodError) return { ok: false, error: error.issues[0]?.message ?? "Check the form and try again." };
  return { ok: false, error: toApiError(error).message };
}

/** The signed-in member's business, refused for viewers and unless it is `merchantId`, the business the page showed. */
export async function editable(merchantId: string) {
  const context = await requireShownMerchant(merchantId);
  assertCanEdit(context);
  return context;
}

/** Critical settings (where money goes and who can move it) are changed only by the owner, on the business the page showed. */
export async function ownerOnly(message: string, merchantId: string) {
  const context = await requireShownMerchant(merchantId);
  if (context.role !== "owner") throw new ApiError(403, "invalid_request", message);
  return context;
}
