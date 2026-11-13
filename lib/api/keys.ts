import { createHash } from "node:crypto";
import { getDb } from "@/lib/db";
import { newId, randomToken } from "@/lib/ids";

/** Merchants have live keys only; test mode exists just for the public demo store, which uses no key. */
export const API_KEY_PATTERN = /^sk_live_[1-9A-HJ-NP-Za-km-z]{32}$/;

export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Creates an API key and returns its secret; only the hash is stored, so the secret is shown once. */
export async function createApiKey(merchantId: string): Promise<{ id: string; secret: string }> {
  const secret = `sk_live_${randomToken(32)}`;
  const key = await getDb().apiKey.create({
    data: { id: newId("key"), merchantId, keyHash: hashApiKey(secret), last4: secret.slice(-4) },
  });
  return { id: key.id, secret };
}

/** The merchant's API keys, newest first, revoked ones included. */
export function merchantApiKeys(merchantId: string) {
  return getDb().apiKey.findMany({ where: { merchantId }, orderBy: { createdAt: "desc" } });
}
