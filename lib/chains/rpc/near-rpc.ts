import { jsonRpc } from "@/lib/chains/rpc/json-rpc";
import { getEnv } from "@/lib/env";

/** One JSON-RPC call to the NEAR RPC; the answer carries either `result` or `error`. */
export function nearRpc<T>(method: string, params: unknown) {
  return jsonRpc<T>(getEnv().NEAR_RPC_URL, method, params);
}

/** True when `publicKey` (`ed25519:…`) is a full-access key of `accountId` on NEAR mainnet. */
export async function hasFullAccessKey(accountId: string, publicKey: string): Promise<boolean> {
  const body = await nearRpc<{ permission?: unknown }>("query", {
    request_type: "view_access_key",
    finality: "final",
    account_id: accountId,
    public_key: publicKey,
  });
  return body.result?.permission === "FullAccess";
}
