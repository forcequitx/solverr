import type { Network } from "@x402/core/types";

/** CAIP-2 identifiers of the chains Solverr merchants can settle on, keyed by 1Click `blockchain` code. */
const CAIP2_BY_BLOCKCHAIN: Readonly<Record<string, Network>> = {
  near: "near:mainnet",
  eth: "eip155:1",
  base: "eip155:8453",
  arb: "eip155:42161",
  op: "eip155:10",
  pol: "eip155:137",
  bsc: "eip155:56",
  avax: "eip155:43114",
  hypercore: "eip155:999",
  sol: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
};

/** CAIP-2 network for a 1Click blockchain code; chains without a CAIP-2 entry use the `solverr` namespace. */
export function caip2Network(blockchain: string): Network {
  return CAIP2_BY_BLOCKCHAIN[blockchain] ?? `solverr:${blockchain}`;
}
