import type { FacilitatorConfig } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import { secureUrl } from "./http.js";
import { priceToCents } from "./price.js";
import { EXACT_SCHEME } from "./protocol.js";

/** CAIP-2 identifier of Base mainnet, the default `exact` network. */
export const BASE_MAINNET = "eip155:8453";

/** Native Circle USDC (6 decimals) per CAIP-2 network with the EIP-712 domain that EIP-3009 signatures commit to;
    the same entries as the default assets of `@x402/evm` 2.30.0. */
export const EXACT_USDC = {
  [BASE_MAINNET]: { asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, name: "USD Coin", version: "2" },
  "eip155:1": { asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, name: "USD Coin", version: "2" },
  "eip155:42161": { asset: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6, name: "USD Coin", version: "2" },
  "eip155:137": { asset: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6, name: "USD Coin", version: "2" },
  "eip155:43114": { asset: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6, name: "USD Coin", version: "2" },
} as const;

/** Native USDC on Base mainnet. */
export const BASE_USDC = EXACT_USDC[BASE_MAINNET];

/** Time the payer has to sign the transfer after receiving the 402. */
export const EXACT_MAX_TIMEOUT_SECONDS = 300;

/** Networks the `exact` scheme accepts: Base, Ethereum, Arbitrum One, Polygon and Avalanche C-Chain. */
export type ExactNetwork = keyof typeof EXACT_USDC;

export interface ExactOptions {
  /** EVM address that receives USDC on `network`. */
  payTo: string;
  /** Base URL of an x402 facilitator that serves `/verify` and `/settle` for `network`. */
  facilitatorUrl: string;
  /** CAIP-2 network the USDC is paid on; defaults to Base (`eip155:8453`). */
  network?: ExactNetwork;
  /** Authentication headers per facilitator path, as returned by `createFacilitatorConfig(...)` of `@coinbase/x402`. */
  createAuthHeaders?: FacilitatorConfig["createAuthHeaders"];
  /** Timeout per facilitator call in milliseconds. */
  timeoutMs?: number;
}

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const CENTS_PER_DOLLAR_DIGITS = 2;

/** Builds the `exact` payment requirement for a USD price; throws on an invalid configuration. */
export function exactRequirements(price: string, currency: string, options: ExactOptions): PaymentRequirements {
  if (currency !== "USD") throw new Error(`exact payments are settled in USDC and require a USD price; got ${JSON.stringify(currency)}.`);
  if (typeof options.payTo !== "string" || !EVM_ADDRESS_PATTERN.test(options.payTo)) {
    throw new Error(`exact.payTo must be a 0x-prefixed 20-byte address; got ${JSON.stringify(options.payTo)}.`);
  }
  const network = options.network ?? BASE_MAINNET;
  if (!Object.hasOwn(EXACT_USDC, network)) {
    throw new Error(`exact.network must be one of ${Object.keys(EXACT_USDC).join(", ")}; got ${JSON.stringify(network)}.`);
  }
  secureUrl(options.facilitatorUrl, "exact.facilitatorUrl");
  const usdc = EXACT_USDC[network];

  return {
    scheme: EXACT_SCHEME,
    network,
    amount: (priceToCents(price) * 10n ** BigInt(usdc.decimals - CENTS_PER_DOLLAR_DIGITS)).toString(),
    asset: usdc.asset,
    payTo: options.payTo,
    maxTimeoutSeconds: EXACT_MAX_TIMEOUT_SECONDS,
    extra: { name: usdc.name, version: usdc.version },
  };
}

const sameAddress = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

/** True when the requirement a client says it paid (`accepted`) is the one this server offers. */
export function matchesRequirements(required: PaymentRequirements, accepted: PaymentRequirements | undefined): boolean {
  if (!accepted || typeof accepted !== "object") return false;
  const extra: Record<string, unknown> = accepted.extra && typeof accepted.extra === "object" ? accepted.extra : {};
  return (
    accepted.scheme === required.scheme &&
    accepted.network === required.network &&
    accepted.amount === required.amount &&
    sameAddress(accepted.asset, required.asset) &&
    sameAddress(accepted.payTo, required.payTo) &&
    accepted.maxTimeoutSeconds === required.maxTimeoutSeconds &&
    Object.entries(required.extra).every(([key, value]) => extra[key] === value)
  );
}
