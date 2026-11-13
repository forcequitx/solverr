import { createPublicClient, http, type Chain, type PublicClient } from "viem";
import { getEnv } from "@/lib/env";

const TIMEOUT_MS = 10_000;

const clients = new Map<number, PublicClient>();

/** A read-only client for `chain` on its `EVM_RPC_URLS` address, or on viem's public RPC when none is set; one per chain. */
export function evmClient(chain: Chain): PublicClient {
  let client = clients.get(chain.id);
  if (!client) {
    client = createPublicClient({ chain, transport: http(getEnv().EVM_RPC_URLS.get(chain.id), { timeout: TIMEOUT_MS, retryCount: 1 }) });
    clients.set(chain.id, client);
  }
  return client;
}
