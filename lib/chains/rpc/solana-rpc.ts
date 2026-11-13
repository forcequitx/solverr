import { jsonRpc } from "@/lib/chains/rpc/json-rpc";
import { getEnv } from "@/lib/env";

/** One JSON-RPC call to the server's Solana RPC (SOLANA_RPC_URL); throws when the RPC answers with an error. */
export async function solanaRpc<T>(method: string, params: unknown[]): Promise<T> {
  const body = await jsonRpc<T>(getEnv().SOLANA_RPC_URL, method, params);
  if (body.error) throw new Error(`Solana RPC ${method} failed: ${String(body.error.message).slice(0, 200)}`);
  return body.result as T;
}
