import type { Merchant, Mode } from "@/generated/prisma/client";
import { API_KEY_PATTERN, hashApiKey } from "@/lib/api/keys";
import { ApiError } from "@/lib/api/errors";
import { getDb } from "@/lib/db";

const BEARER = /^bearer +(.+)$/i;

/** Merchant API calls always work on live data; test mode exists only for the public demo store, which uses no key. */
type MerchantAuth = { merchant: Merchant; mode: Extract<Mode, "live">; apiKeyId: string };

/** Authenticates `Authorization: Bearer sk_live_…` and returns the key's merchant. */
export async function authenticateMerchant(request: Request): Promise<MerchantAuth> {
  /** The scheme name is case-insensitive (RFC 9110), so `bearer` works too. */
  const secret = BEARER.exec(request.headers.get("authorization") ?? "")?.[1].trim() ?? "";
  if (!API_KEY_PATTERN.test(secret)) {
    throw new ApiError(401, "authentication_failed", "Send your API key as: Authorization: Bearer sk_live_…");
  }

  const key = await getDb().apiKey.findUnique({
    where: { keyHash: hashApiKey(secret) },
    include: { merchant: true },
  });
  if (!key || key.revokedAt) {
    throw new ApiError(401, "authentication_failed", "This API key is not valid or was revoked. Create a new key in Dashboard → Developers.");
  }
  return { merchant: key.merchant, mode: "live", apiKeyId: key.id };
}
