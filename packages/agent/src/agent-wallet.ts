import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  X402_VERSION,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
  readHeader,
  type SolverrPaymentPayload,
  type PaymentPayload,
} from "solverr-x402";
import { fetch, Headers, type Dispatcher, type RequestInit, type Response } from "undici";
import { formatUnits } from "viem";
import { DEFAULT_ASSETS, type WalletAsset } from "./assets.js";
import { BaseWallet } from "./chains/base.js";
import type { ChainWallet } from "./chains/chain-wallet.js";
import { NearWallet } from "./chains/near.js";
import { parseChallenge, type SolverrChallenge } from "./challenge.js";
import {
  DEFAULT_PAYMENT_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_RESOURCE_TIMEOUT_MS,
  PAID_REQUEST_ATTEMPTS,
  PAID_REQUEST_MAX_WAIT_MS,
  PAID_REQUEST_RETRY_MS,
} from "./config.js";
import { PaymentError, errorSummary } from "./errors.js";
import { GatewayClient } from "./gateway.js";
import { isHostAllowed, normalizeLimits, type SpendingLimits } from "./limits.js";
import { Payer } from "./payer.js";
import { SpendLog, type SpendEntry } from "./spend-log.js";
import { sleep } from "./timeout.js";

export interface AgentWalletOptions {
  near?: { accountId: string; privateKey: string; rpcUrl?: string };
  base?: { privateKey: string; rpcUrl?: string };
  limits: SpendingLimits;
  /** Spend log file; defaults to `~/.solverr/agent-spend-log.json`. */
  spendLogPath?: string;
  /** Coins to check and pay with; defaults to USDC, USDT and wNEAR on NEAR, and USDC and ETH on Base. */
  assets?: WalletAsset[];
  /** Solverr gateway URLs the agent will pay through, such as `https://pay.example.com`. At least one is required. */
  trustedGateways: string[];
  /** How long to wait for an invoice to be paid after sending. Default 3 minutes. */
  paymentTimeoutMs?: number;
  /** Timeout of each RPC and gateway call. Default 15 seconds. */
  requestTimeoutMs?: number;
  /** Timeout of each paid request, and of the first request when no `signal` is passed, body included. Default 30 seconds; raise it for
      endpoints that take longer to answer or stream their body. */
  resourceTimeoutMs?: number;
}

export interface AssetBalance {
  asset_id: string;
  symbol: string;
  blockchain: string;
  address: string;
  amount: string;
  amount_base: string;
}

export interface SpendingSummary {
  limits: SpendingLimits;
  spent_last_24h_usd: number;
  remaining_today_usd: number;
  recent: SpendEntry[];
}

/** Init for undici's `fetch`: `dispatcher` may be an undici dispatcher pinned to approved addresses (Node's `fetch` refuses those). */
export type AgentFetchInit = RequestInit & { dispatcher?: Dispatcher };

export interface AgentWallet {
  /** Like `fetch`, but pays `solverr` x402 challenges within the limits and then sends the request again with the payment. */
  fetch(input: string | URL, init?: AgentFetchInit): Promise<Response>;
  balances(): Promise<{ balances: AssetBalance[]; errors: string[] }>;
  spending(): Promise<SpendingSummary>;
  /** The current spending limits, read without the spend log. */
  limits(): SpendingLimits;
  setLimits(limits: Partial<SpendingLimits>): SpendingLimits;
  /** The invoice of a payment kept for `method` and `url` because the site answered the paid request with an error;
      the next 402 there sends that payment again before anything new is paid. */
  unusedInvoice(url: string | URL, method?: string): string | undefined;
}

/** A paid invoice and the `PAYMENT-SIGNATURE` header value that redeems it. */
interface PaidInvoice {
  invoiceId: string;
  signature: string;
}

const RECENT_ENTRIES = 20;

/** Whether a request body can be sent again after paying; streams and (async) iterables are used up by the first request. */
function isReplayableBody(body: RequestInit["body"]): boolean {
  return (
    body === undefined ||
    body === null ||
    typeof body === "string" ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof URLSearchParams
  );
}

/** `Retry-After` in milliseconds, read as delay-seconds like `requestJson` in solverr-x402; 0 when it is missing or not a number. */
const retryAfterMs = (response: Response) => Number(response.headers.get("Retry-After") ?? 0) * 1000 || 0;

/** The method, origin and path a kept payment belongs to; the paywall binds each invoice to the method and path it was issued for. */
const paymentKey = (method: string | undefined, url: URL) => `${(method ?? "GET").toUpperCase()} ${url.origin}${url.pathname}`;

/** Sends a request carrying a paid invoice, retrying after a network error, 429, 5xx, or a 402 that follows an attempt with no answer (whose request
    may still be using the payment); each attempt has `attemptTimeoutMs`. A 429 or 503 waits at least its `Retry-After`, capped at PAID_REQUEST_MAX_WAIT_MS,
    and no wait ends later than `timeoutMs` after the first send. Returns any other response below 500; throws `PaymentError` with `fundsSent` at the end. */
async function fetchPaid(url: URL, init: AgentFetchInit, invoiceId: string, timeoutMs: number, attemptTimeoutMs: number): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let failure = "no response";
  let retryAfter = 0;
  let unanswered = false;
  for (let attempt = 1; attempt <= PAID_REQUEST_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      const delay = Math.min(Math.max(PAID_REQUEST_RETRY_MS * (attempt - 1), retryAfter), PAID_REQUEST_MAX_WAIT_MS);
      if (Date.now() + delay > deadline) break;
      await sleep(delay);
    }
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(attemptTimeoutMs) });
    } catch (error) {
      failure = errorSummary(error, 120);
      retryAfter = 0;
      unanswered = true;
      continue;
    }
    if (response.status === 402 && unanswered) {
      failure = "HTTP 402 while an earlier attempt may still be using the payment";
      retryAfter = 0;
      await response.body?.cancel();
      continue;
    }
    if (response.status !== 429 && response.status < 500) return response;
    failure = `HTTP ${response.status}`;
    retryAfter = response.status === 429 || response.status === 503 ? retryAfterMs(response) : 0;
    await response.body?.cancel();
  }
  throw new PaymentError(
    "paid_request_failed",
    `Invoice ${invoiceId} is paid, but the request to ${url.host} with the payment failed (${failure}). The wallet keeps this payment and sends it again on the next request to the same URL instead of paying again.`,
    true,
    invoiceId,
  );
}

/** Creates an agent wallet. Keys stay in memory and are only used to sign transfers on this machine. */
export function createAgentWallet(options: AgentWalletOptions): AgentWallet {
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const wallets: ChainWallet[] = [];
  if (options.near) wallets.push(new NearWallet({ ...options.near, requestTimeoutMs }));
  if (options.base) wallets.push(new BaseWallet({ ...options.base, requestTimeoutMs }));
  if (wallets.length === 0) throw new Error("Configure at least one wallet: near or base.");

  if (!options.trustedGateways?.length) {
    throw new Error("Set trustedGateways to the Solverr URLs the agent may pay through, such as https://pay.example.com.");
  }
  const trustedGateways = options.trustedGateways.map((gateway) => new URL(gateway).origin);
  const assets = (options.assets ?? DEFAULT_ASSETS).filter((asset) => wallets.some((wallet) => wallet.blockchain === asset.blockchain));
  const spendLog = new SpendLog(options.spendLogPath);
  let limits = normalizeLimits(options.limits);
  const paymentTimeoutMs = options.paymentTimeoutMs ?? DEFAULT_PAYMENT_TIMEOUT_MS;
  const resourceTimeoutMs = options.resourceTimeoutMs ?? DEFAULT_RESOURCE_TIMEOUT_MS;
  const payer = new Payer({ wallets, assets, spendLog, gateway: new GatewayClient(requestTimeoutMs), limits: () => limits, paymentTimeoutMs });
  /** Paid invoices a site answered with an error, by `paymentKey`. The paywall releases such a payment, so it is sent again instead of paying anew;
      it is dropped once the site accepts it (below 400) or refuses it with 402. Nothing is reserved or logged for a resend, since nothing is spent. */
  const unusedPayments = new Map<string, PaidInvoice>();

  /** Sends the request with `payment` and returns the response, 402 included; an error of 400 or more other than 402, or no response at all,
      keeps the payment under `key`. */
  async function sendPayment(url: URL, init: AgentFetchInit, payment: PaidInvoice, key: string): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set(PAYMENT_SIGNATURE_HEADER, payment.signature);
    let response: Response;
    try {
      response = await fetchPaid(url, { ...init, headers }, payment.invoiceId, paymentTimeoutMs, resourceTimeoutMs);
    } catch (error) {
      unusedPayments.set(key, payment);
      throw error;
    }
    if (response.status >= 400 && response.status !== 402) unusedPayments.set(key, payment);
    return response;
  }

  async function paidFetch(input: string | URL, init: AgentFetchInit = {}): Promise<Response> {
    const request = { ...init, signal: init.signal ?? AbortSignal.timeout(resourceTimeoutMs) };
    const first = await fetch(input, request);
    if (first.status !== 402) return first;
    let challenge: SolverrChallenge | undefined;
    try {
      challenge = parseChallenge(first.headers.get(PAYMENT_REQUIRED_HEADER), trustedGateways);
      if (challenge && !isReplayableBody(init.body)) throw new PaymentError("body_not_replayable", "A streamed request body cannot be sent again after paying; pass a string or buffer.");
    } catch (error) {
      await first.body?.cancel();
      throw error;
    }
    if (!challenge) return first;

    /** The URL that answered 402 (after redirects) is the one checked against the allow list and retried. */
    const resourceUrl = new URL(first.url || input.toString());
    await first.body?.cancel();
    const key = paymentKey(init.method, resourceUrl);
    const unused = unusedPayments.get(key);
    /** Taken out while it is sent once, so concurrent calls never send the same kept payment together. */
    if (unused && isHostAllowed(resourceUrl.hostname, limits.allow)) {
      unusedPayments.delete(key);
      const resent = await sendPayment(resourceUrl, init, unused, key);
      if (resent.status !== 402) return resent;
      await resent.body?.cancel();
    }

    /** The caller's signal can stop the payment up to the transfer; after that the paid request is always completed. */
    await payer.pay(resourceUrl, challenge, init.signal ?? undefined);

    const invoiceId = challenge.extra.invoice_id;
    const payment: PaymentPayload = {
      x402Version: X402_VERSION,
      resource: challenge.paymentRequired.resource,
      accepted: challenge.requirement,
      payload: { invoice_id: invoiceId } satisfies SolverrPaymentPayload,
    };
    const response = await sendPayment(resourceUrl, init, { invoiceId, signature: encodePaymentSignatureHeader(payment) }, key);
    if (response.status !== 402) return response;
    const settlement = readHeader(response.headers.get(PAYMENT_RESPONSE_HEADER), decodePaymentResponseHeader);
    await response.body?.cancel();
    throw new PaymentError(
      "paid_request_failed",
      `Invoice ${invoiceId} is paid, but ${resourceUrl.host} refused the payment: ${settlement?.errorMessage ?? "402 Payment Required"}. Do not pay for this request again; ask the site about invoice ${invoiceId}.`,
      true,
      invoiceId,
    );
  }

  return {
    fetch: paidFetch,

    async balances() {
      const errors: string[] = [];
      const results = await Promise.all(
        assets.map(async (asset): Promise<AssetBalance | undefined> => {
          const wallet = wallets.find((item) => item.blockchain === asset.blockchain)!;
          try {
            const amount = await wallet.balance(asset);
            return { asset_id: asset.asset_id, symbol: asset.symbol, blockchain: asset.blockchain, address: wallet.address, amount: formatUnits(amount, asset.decimals), amount_base: amount.toString() };
          } catch (error) {
            errors.push(`${asset.symbol} on ${asset.blockchain}: ${errorSummary(error, 120)}`);
            return undefined;
          }
        }),
      );
      return { balances: results.filter((item): item is AssetBalance => item !== undefined), errors };
    },

    async spending() {
      const spent = await spendLog.spentLast24hUsd();
      const entries = await spendLog.entries();
      return {
        limits,
        spent_last_24h_usd: spent,
        remaining_today_usd: Math.max(0, limits.dailyUsd - spent),
        recent: entries.slice(-RECENT_ENTRIES).reverse(),
      };
    },

    limits() {
      return limits;
    },

    setLimits(changes) {
      limits = normalizeLimits({ ...limits, ...changes });
      return limits;
    },

    unusedInvoice(url, method) {
      return unusedPayments.get(paymentKey(method, new URL(url)))?.invoiceId;
    },
  };
}
