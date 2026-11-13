import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOLVERR_SCHEME, X402_VERSION, encodePaymentRequiredHeader, type PaymentRequired, type SolverrRequirementExtra } from "solverr-x402";
import { vi } from "vitest";
import type { WalletAsset } from "../src/assets.js";
import type { ChainWallet } from "../src/chains/chain-wallet.js";
import type { GatewayQuote, GatewayToken } from "../src/gateway.js";

export const GATEWAY = "https://pay.example.com";
export const INVOICE_ID = "inv_1";

export const USDC_BASE: WalletAsset = {
  asset_id: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  symbol: "USDC",
  blockchain: "base",
  decimals: 6,
  contract_address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
};
export const USDC_NEAR: WalletAsset = {
  asset_id: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  symbol: "USDC",
  blockchain: "near",
  decimals: 6,
  contract_address: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
};
export const USDT_NEAR: WalletAsset = { asset_id: "nep141:usdt.tether-token.near", symbol: "USDT", blockchain: "near", decimals: 6, contract_address: "usdt.tether-token.near" };
export const ETH_BASE: WalletAsset = { asset_id: "nep141:base.omft.near", symbol: "ETH", blockchain: "base", decimals: 18, contract_address: null };

export const token = (asset: WalletAsset, priceUsd: number): GatewayToken => ({ ...asset, price_usd: priceUsd });

/** The `extra` of a live `solverr` requirement for invoice `inv_1` on the test gateway; `overrides` replace fields. */
export function solverrExtra(overrides: Partial<SolverrRequirementExtra> = {}): SolverrRequirementExtra {
  const root = `${GATEWAY}/api/v1/invoices/${INVOICE_ID}`;
  return {
    invoice_id: INVOICE_ID,
    mode: "live",
    checkout_url: `${GATEWAY}/pay/${INVOICE_ID}`,
    quote_url: `${root}/quote`,
    deposit_url: `${root}/deposit`,
    status_url: `${root}/status`,
    price: "4",
    currency: "USD",
    settlement: { asset_id: USDC_BASE.asset_id, symbol: "USDC", blockchain: "base", amount: "4" },
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    credits: false,
    ...overrides,
  };
}

export function paymentRequired(extra: object = solverrExtra(), scheme = SOLVERR_SCHEME): PaymentRequired {
  return {
    x402Version: X402_VERSION,
    resource: { url: "https://api.example.com/data", description: "Data", mimeType: "application/json" },
    accepts: [{ scheme, network: "near:mainnet", amount: "4000000", asset: USDC_BASE.asset_id, payTo: "solverr", maxTimeoutSeconds: 600, extra: extra as Record<string, unknown> }],
  } as PaymentRequired;
}

export const challengeHeader = (extra: object = solverrExtra(), scheme = SOLVERR_SCHEME) => encodePaymentRequiredHeader(paymentRequired(extra, scheme));

/** A chain wallet that never touches a network: fixed balances per asset ID and a recorded `transfer`. */
export function fakeWallet(blockchain: string, address: string, balances: Record<string, bigint> = {}) {
  return {
    blockchain,
    address,
    balance: vi.fn(async (asset: WalletAsset) => balances[asset.asset_id] ?? 0n),
    isValidRecipient: vi.fn((recipient: string) => recipient.length > 0 && !recipient.includes(" ")),
    transfer: vi.fn(async (_asset: WalletAsset, _to: string, _amount: bigint) => ({ hash: "0xtxhash" })),
  } satisfies ChainWallet;
}

export function quoteFor(asset: WalletAsset, refundAddress: string, overrides: Partial<GatewayQuote> = {}): GatewayQuote {
  return {
    id: "quote_1",
    coin: { asset_id: asset.asset_id, symbol: asset.symbol, blockchain: asset.blockchain, decimals: asset.decimals },
    amount_in: "4.1",
    amount_in_base: "4100000",
    deposit_address: "0x1111111111111111111111111111111111111111",
    deposit_memo: null,
    refund_address: refundAddress,
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
    ...overrides,
  };
}

/** A JSON-RPC answer: a `result`, an `error` object, or a whole HTTP response. */
export type RpcReply = { result: unknown } | { error: { code: number; message: string; data?: unknown } } | Response;

export interface RpcCall {
  url: string;
  method: string;
  params: unknown;
}

/** Replaces the global `fetch` (used by near-api-js and viem) with a JSON-RPC node answered by `reply`; returns every call it received, in order.
Undo it with `vi.unstubAllGlobals()`. */
export function stubJsonRpc(reply: (method: string, params: unknown) => RpcReply | Promise<RpcReply>): RpcCall[] {
  const calls: RpcCall[] = [];
  const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { id: unknown; method: string; params: unknown };
    calls.push({ url: String(url), method: request.method, params: request.params });
    const answer = await abortable(Promise.resolve(reply(request.method, request.params)), init?.signal);
    return answer instanceof Response ? answer : Response.json({ jsonrpc: "2.0", id: request.id, ...answer });
  });
  vi.stubGlobal("fetch", fetchStub);
  return calls;
}

/** Like the real `fetch`, rejects with the signal's reason once `signal` aborts. */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** A promise that never settles, for an RPC call that hangs; `reached` resolves once the call is made. */
export function hangingReply(): { reply: () => Promise<never>; reached: Promise<void> } {
  let markReached = () => {};
  const reached = new Promise<void>((resolve) => (markReached = resolve));
  return { reply: () => (markReached(), new Promise<never>(() => {})), reached };
}

/** A new empty folder under the OS temp folder, removed by the returned `cleanup`. */
export async function tempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "solverr-agent-test-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
