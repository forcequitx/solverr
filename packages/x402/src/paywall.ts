import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import type { Network, PaymentPayload, PaymentRequired, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { MemoryClaimStore, type ClaimStore } from "./claim-store.js";
import { assertDiscovery, BAZAAR_EXTENSION, type BazaarDiscovery } from "./discovery.js";
import { EXACT_MAX_TIMEOUT_SECONDS, exactRequirements, matchesRequirements, type ExactOptions } from "./exact.js";
import { Facilitator, FacilitatorUnavailableError } from "./facilitator.js";
import { SolverrApiError } from "./http.js";
import { MerchantClient, type Invoice } from "./merchant-client.js";
import { caip2Network } from "./networks.js";
import { assertPrice, priceToCents, type Currency } from "./price.js";
import {
  EXACT_SCHEME,
  SOLVERR_SCHEME,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  X402_VERSION,
  readHeader,
  type SolverrRequirementExtra,
} from "./protocol.js";

export interface PaywallOptions {
  /** Price per request as a decimal string, for example `"0.05"`. */
  price: string;
  currency: Currency;
  /** Solverr API key (`sk_live_…`). */
  apiKey: string | undefined;
  /** Base URL of the Solverr app, for example `https://solverr.example`. */
  baseUrl: string;
  /** Shown to the payer on the invoice; defaults to the method and path. */
  description?: string;
  /** Also accept prepaid credit tokens in `Authorization: Bearer solverr_credit_…`. */
  credits?: boolean;
  /** Invoice lifetime in seconds (900–86400). Defaults to 900. */
  expiresIn?: number;
  /** Timeout per Solverr API call in milliseconds. */
  timeoutMs?: number;
  /** Also accept the standard x402 `exact` scheme: USDC on one EVM network (Base by default), verified and settled by a facilitator. Requires a USD price. */
  exact?: ExactOptions;
  /** Bazaar discovery metadata sent in every 402, so a facilitator that runs a Bazaar can list the route when it settles an `exact` payment. */
  discovery?: BazaarDiscovery;
  /** Limits payment challenges per client: each 402 creates an invoice and a key may create 1200 a minute, so unlimited anonymous traffic causes 503s.
      `key` names the client (such as the IP a trusted proxy sets; undefined is not limited); over the limit every request from it, paid ones too, gets 429. */
  challengeLimit?: { key: (request: Request) => string | undefined; perMinute: number };
  /** Where payment claims are kept; defaults to this process's memory. On serverless or several processes, pass one shared store
      (`RedisClaimStore`, `PostgresClaimStore` or a custom one) so copies of a payment sent to several instances run the handler once. */
  claimStore?: ClaimStore;
}

/** Outcome of settling a payment after the handler ran: headers to add, or the response that replaces the handler's. */
export type PaywallSettlement = { success: true; headers: Record<string, string> } | { success: false; response: Response };

/** Let the request through with extra headers, or answer with `response`. Call `settle` after a successful handler response, before sending it;
    if the handler fails or answers 400+, call `release` (await it on hosts that stop work after responding) so the payment can be used again. */
export type PaywallDecision =
  | { granted: true; headers: Record<string, string>; settle?: () => Promise<PaywallSettlement>; release?: () => void | Promise<void> }
  | { granted: false; response: Response };

export const CREDIT_TOKEN_PREFIX = "solverr_credit_";
export const CREDIT_BALANCE_HEADER = "Solverr-Credit-Balance";
/** Invoice metadata key that binds an invoice to the method and path it pays for. */
export const RESOURCE_METADATA_KEY = "solverr_resource";

const DEFAULT_EXPIRES_IN = 900;
const MAX_METADATA_VALUE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 500;
/** The credits API accepts charge descriptions up to 200 characters. */
const MAX_CHARGE_DESCRIPTION_LENGTH = 200;
const INVOICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const EXPOSED_HEADERS = `${PAYMENT_REQUIRED_HEADER}, ${PAYMENT_RESPONSE_HEADER}, ${CREDIT_BALANCE_HEADER}`;
/** Handler responses with this status or higher are sent without settling the payment. */
export const UNSETTLED_STATUS = 400;
/** A rejected payment can concern any offered scheme, so its settlement response names no network. */
const NO_NETWORK = "" as Network;

class PaymentRejected extends Error {
  constructor(
    readonly reason: string,
    message: string,
    readonly status = 402,
  ) {
    super(message);
  }
}

/** The claim store failed while claiming, so the payment is answered 503 instead of reaching the handler unclaimed. */
class ClaimStoreUnavailableError extends Error {}

/** Solverr refused to create the challenge invoice for a reason that retrying cannot fix, such as an unsupported settlement coin. */
class InvoiceCreationRefused extends Error {
  constructor(readonly cause: SolverrApiError) {
    super(cause.message);
  }
}

/** The method and path an invoice pays for, as stored in its metadata. */
function resourceKey(request: Request): string {
  return `${request.method.toUpperCase()} ${new URL(request.url).pathname}`.slice(0, MAX_METADATA_VALUE_LENGTH);
}

function bearerCreditToken(request: Request): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  return match?.[1].startsWith(CREDIT_TOKEN_PREFIX) ? match[1] : undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Expose-Headers": EXPOSED_HEADERS, ...headers },
  });
}

/** The `exact` requirement offered for one resource and the facilitator that verifies and settles it. */
interface ExactPaywall {
  requirements: PaymentRequirements;
  facilitator: Facilitator;
}

/** A payment claim this request holds: the payment's key and the owner token that may renew or release it. */
interface PaymentClaim {
  key: string;
  owner: string;
}

/** Claims of payments (verified `exact` transfers and paid invoices) for every paywall in this process without its own `claimStore`. */
const processClaims = new MemoryClaimStore();
const CLAIM_MS = EXACT_MAX_TIMEOUT_SECONDS * 1000;
const MAX_LOGGED_ERROR_LENGTH = 300;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, MAX_LOGGED_ERROR_LENGTH);

const UINT256_DECIMAL = /^[0-9]{1,78}$/;

/** Identifies one signed transfer by its payer and nonce, reading the authorization the facilitator settles (Permit2 whenever present, else EIP-3009)
    with the nonce in one spelling (Permit2 decimal without leading zeros, EIP-3009 `0x` hex), so copies written differently share a key;
    anything else by the whole payload. */
function exactPaymentKey(payload: Record<string, unknown>): string {
  const permit2 = "permit2Authorization" in payload;
  const authorization = permit2 ? payload.permit2Authorization : payload.authorization;
  if (isRecord(authorization) && typeof authorization.from === "string" && typeof authorization.nonce === "string") {
    const nonce = permit2 && UINT256_DECIMAL.test(authorization.nonce) ? BigInt(authorization.nonce).toString() : `0x${authorization.nonce.replace(/^0x/i, "")}`;
    return `${authorization.from}:${nonce}`.toLowerCase();
  }
  return JSON.stringify(payload);
}

const CHALLENGE_WINDOW_MS = 60_000;
const CHALLENGE_SWEEP_EVERY = 1000;

/** Checks x402 payments and credit tokens for one priced resource. */
export class Paywall {
  private readonly client: MerchantClient;
  private readonly exact?: ExactPaywall;
  private readonly claims: ClaimStore;
  /** Challenges per client key in the current minute, for `challengeLimit`; expired entries are swept every CHALLENGE_SWEEP_EVERY calls. */
  private readonly challengeCounts = new Map<string, { startedAt: number; count: number }>();
  private challengesCounted = 0;

  constructor(private readonly options: PaywallOptions) {
    assertPrice(options.price, options.currency);
    if (!options.apiKey?.startsWith("sk_live_")) {
      throw new Error("apiKey must be a Solverr API key (sk_live_…).");
    }
    if (options.credits && options.currency !== "USD") {
      throw new Error(`credits require a USD price: credit balances are kept in USD; got ${JSON.stringify(options.currency)}.`);
    }
    if (options.discovery) assertDiscovery(options.discovery);
    if (options.expiresIn !== undefined && !(Number.isInteger(options.expiresIn) && options.expiresIn >= 900 && options.expiresIn <= 86400)) {
      throw new Error(`expiresIn must be a whole number of seconds from 900 to 86400; got ${JSON.stringify(options.expiresIn)}.`);
    }
    if (options.challengeLimit && !(Number.isInteger(options.challengeLimit.perMinute) && options.challengeLimit.perMinute > 0)) {
      throw new Error(`challengeLimit.perMinute must be a positive whole number; got ${JSON.stringify(options.challengeLimit.perMinute)}.`);
    }
    this.client = new MerchantClient({ apiKey: options.apiKey, baseUrl: options.baseUrl, timeoutMs: options.timeoutMs });
    this.claims = options.claimStore ?? processClaims;
    if (options.exact) {
      this.exact = {
        requirements: exactRequirements(options.price, options.currency, options.exact),
        facilitator: new Facilitator({ url: options.exact.facilitatorUrl, createAuthHeaders: options.exact.createAuthHeaders, timeoutMs: options.exact.timeoutMs }),
      };
    }
  }

  /** Decides whether `request` has paid; never throws for payment problems, and answers 402, 400, 429 (`challengeLimit`), 500 (setup refused) or 503. */
  async authorize(request: Request): Promise<PaywallDecision> {
    /** A client over `challengeLimit` is refused before any Solverr call, so fake signatures or credit tokens cannot spend the key's API budgets. */
    const limited = this.challengeLimitResponse(request, false);
    if (limited) return { granted: false, response: limited };
    try {
      const creditToken = this.options.credits ? bearerCreditToken(request) : undefined;
      const signature = request.headers.get(PAYMENT_SIGNATURE_HEADER);
      if (signature) return await this.acceptPayment(request, signature);
      if (creditToken) return await this.chargeCredits(request, creditToken);
      return { granted: false, response: await this.challenge(request) };
    } catch (error) {
      return { granted: false, response: await this.rejection(request, error) };
    }
  }

  /** The 429 when the request's client is over `challengeLimit`, else undefined; with `count`, the request is a new challenge counted first. */
  private challengeLimitResponse(request: Request, count: boolean): Response | undefined {
    const limit = this.options.challengeLimit;
    const key = limit?.key(request);
    if (!limit || key === undefined) return undefined;
    const now = Date.now();
    if (count && ++this.challengesCounted % CHALLENGE_SWEEP_EVERY === 0) {
      for (const [held, window] of this.challengeCounts) if (now - window.startedAt >= CHALLENGE_WINDOW_MS) this.challengeCounts.delete(held);
    }
    const current = this.challengeCounts.get(key);
    const window = current && now - current.startedAt < CHALLENGE_WINDOW_MS ? current : { startedAt: now, count: 0 };
    if (count) {
      window.count += 1;
      this.challengeCounts.set(key, window);
    }
    if (window.count <= limit.perMinute) return undefined;
    const retryAfter = Math.max(1, Math.ceil((window.startedAt + CHALLENGE_WINDOW_MS - now) / 1000));
    return jsonResponse(429, { error: { type: "rate_limited", message: "Too many payment requests from this client. Try again shortly." } }, { "Retry-After": String(retryAfter) });
  }

  private async challenge(request: Request, error?: string, settlement?: SettleResponse): Promise<Response> {
    const limited = this.challengeLimitResponse(request, true);
    if (limited) return limited;
    let invoice: Invoice;
    try {
      invoice = await this.client.createInvoice({
        amount: this.options.price,
        currency: this.options.currency,
        description: (this.options.description ?? `Access to ${resourceKey(request)}`).slice(0, MAX_DESCRIPTION_LENGTH),
        metadata: { [RESOURCE_METADATA_KEY]: resourceKey(request) },
        expires_in: this.options.expiresIn ?? DEFAULT_EXPIRES_IN,
      });
    } catch (error) {
      const permanent =
        error instanceof SolverrApiError &&
        (error.type === "redirect" || (error.status !== undefined && error.status >= 400 && error.status < 500 && error.status !== 429));
      throw permanent ? new InvoiceCreationRefused(error) : error;
    }
    const paymentRequired = this.paymentRequired(request, invoice, error);
    const headers: Record<string, string> = { [PAYMENT_REQUIRED_HEADER]: encodePaymentRequiredHeader(paymentRequired) };
    if (settlement) headers[PAYMENT_RESPONSE_HEADER] = encodePaymentResponseHeader(settlement);
    return jsonResponse(402, paymentRequired, headers);
  }

  private paymentRequired(request: Request, invoice: Invoice, error?: string): PaymentRequired {
    const extra: SolverrRequirementExtra = {
      invoice_id: invoice.id,
      mode: invoice.mode,
      checkout_url: invoice.checkout_url,
      quote_url: this.client.invoiceUrl(invoice.id, "quote"),
      deposit_url: this.client.invoiceUrl(invoice.id, "deposit"),
      status_url: this.client.invoiceUrl(invoice.id, "status"),
      price: this.options.price,
      currency: this.options.currency,
      settlement: {
        asset_id: invoice.settlement.asset_id,
        symbol: invoice.settlement.symbol,
        blockchain: invoice.settlement.blockchain,
        amount: invoice.settlement.amount,
      },
      expires_at: invoice.expires_at,
      credits: this.options.credits === true,
    };
    const secondsLeft = Math.max(0, Math.floor((Date.parse(invoice.expires_at) - Date.now()) / 1000));
    return {
      x402Version: X402_VERSION,
      ...(error ? { error } : {}),
      resource: { url: request.url, description: this.options.description ?? `Access to ${resourceKey(request)}` },
      accepts: [
        {
          scheme: SOLVERR_SCHEME,
          network: caip2Network(invoice.settlement.blockchain),
          amount: invoice.settlement.amount_base,
          asset: invoice.settlement.asset_id,
          payTo: invoice.id,
          maxTimeoutSeconds: secondsLeft,
          extra: { ...extra },
        },
        ...(this.exact ? [this.exact.requirements] : []),
      ],
      ...(this.options.discovery ? { extensions: { [BAZAAR_EXTENSION]: this.options.discovery } } : {}),
    };
  }

  private async acceptPayment(request: Request, signature: string): Promise<PaywallDecision> {
    const payment = readHeader(signature, decodePaymentSignatureHeader);
    if (!payment) throw new PaymentRejected("invalid_payload", "PAYMENT-SIGNATURE is not base64-encoded JSON.", 400);
    if (payment.x402Version !== X402_VERSION) throw new PaymentRejected("invalid_x402_version", `Only x402 version ${X402_VERSION} is supported.`);
    const scheme = payment.accepted?.scheme;
    if (scheme === SOLVERR_SCHEME) return this.claimInvoice(request, payment);
    if (scheme === EXACT_SCHEME && this.exact) return this.verifyExact(request, payment, this.exact);
    const schemes = [SOLVERR_SCHEME, ...(this.exact ? [EXACT_SCHEME] : [])].map((name) => `"${name}"`).join(" or ");
    throw new PaymentRejected("unsupported_scheme", `Only the ${schemes} scheme is accepted.`);
  }

  /** Checks that a `solverr` payment's invoice is paid for this resource and price, and claims it for this request.
      The invoice is redeemed only in `settle`, after the handler succeeded, so a failed handler leaves the payment usable. */
  private async claimInvoice(request: Request, payment: PaymentPayload): Promise<PaywallDecision> {
    const invoiceId = payment.payload?.invoice_id;
    if (typeof invoiceId !== "string" || !INVOICE_ID_PATTERN.test(invoiceId)) {
      throw new PaymentRejected("invalid_payload", "payload.invoice_id is missing or malformed.", 400);
    }

    const invoice = await this.client.getInvoice(invoiceId);
    if (invoice.metadata?.[RESOURCE_METADATA_KEY] !== resourceKey(request)) {
      throw new PaymentRejected("invalid_payment_requirements", "This invoice was issued for a different resource.");
    }
    if (invoice.currency !== this.options.currency || priceToCents(invoice.amount) !== priceToCents(this.options.price)) {
      throw new PaymentRejected("invalid_payment_requirements", "This invoice does not match the current price.");
    }
    if (invoice.status !== "paid") {
      throw new PaymentRejected("invalid_transaction_state", `This invoice is ${invoice.status.replace(/_/g, " ")}, not paid.`);
    }
    /** Refused before the handler runs, so replaying a used payment never gets the handler's work for free. */
    if (invoice.redeemed_at) throw new PaymentRejected("invalid_transaction_state", "This payment was already used.");
    const claim = await this.claimPayment(`invoice:${invoiceId}`);
    return {
      granted: true,
      headers: { "Access-Control-Expose-Headers": EXPOSED_HEADERS },
      settle: () => this.redeemInvoice(request, invoice, claim),
      release: () => this.releaseClaim(claim),
    };
  }

  /** Claims a payment for one request; refused while another request holds it. */
  private async claimPayment(key: string): Promise<PaymentClaim> {
    let owner: string | null;
    try {
      owner = await this.claims.claim(key, CLAIM_MS);
    } catch (error) {
      throw new ClaimStoreUnavailableError(`The claim store could not claim a payment: ${errorText(error)}`);
    }
    if (owner === null) throw new PaymentRejected("invalid_transaction_state", "This payment is already being used by another request.");
    return { key, owner };
  }

  /** Frees a claim so the payment can be used again; a store failure is logged, and the claim then lapses after CLAIM_MS. */
  private async releaseClaim(claim: PaymentClaim): Promise<void> {
    try {
      await this.claims.release(claim.key, claim.owner);
    } catch (error) {
      console.error(`Solverr paywall: the claim store could not release a payment claim, which lapses on its own: ${errorText(error)}`);
    }
  }

  /** Holds a settled payment's claim for CLAIM_MS more, so a copy that read the payment before it settled cannot run the handler. */
  private async renewClaim(claim: PaymentClaim): Promise<void> {
    try {
      await this.claims.renew(claim.key, claim.owner, CLAIM_MS);
    } catch (error) {
      console.error(`Solverr paywall: the claim store could not renew a settled payment's claim: ${errorText(error)}`);
    }
  }

  /** Redeems a claimed invoice after the handler succeeded; a failed redeem frees the claim and answers through `rejection` (402, 500 or 503).
      A successful one keeps the claim until it lapses: a copy of the same payment may have read the invoice before the redeem and must not run the handler. */
  private async redeemInvoice(request: Request, invoice: Invoice, claim: PaymentClaim): Promise<PaywallSettlement> {
    try {
      const { payment } = await this.client.redeemInvoice(invoice.id);
      await this.renewClaim(claim);
      /** As on the public checkout, a private payment's delivery to the merchant's wallet is left out, since it would link the two. */
      const delivery = payment && !payment.confidential ? payment.destination_transactions[0]?.hash : undefined;
      const settlement: SettleResponse = {
        success: true,
        transaction: delivery ?? "",
        network: caip2Network(invoice.settlement.blockchain),
        amount: invoice.settlement.amount_base,
        ...(payment?.refund_address ? { payer: payment.refund_address } : {}),
      };
      return { success: true, headers: { [PAYMENT_RESPONSE_HEADER]: encodePaymentResponseHeader(settlement), "Access-Control-Expose-Headers": EXPOSED_HEADERS } };
    } catch (error) {
      await this.releaseClaim(claim);
      return { success: false, response: await this.rejection(request, error) };
    }
  }

  /** Verifies an `exact` payment with the facilitator; settlement waits until the handler has succeeded. */
  private async verifyExact(request: Request, payment: PaymentPayload, exact: ExactPaywall): Promise<PaywallDecision> {
    const { requirements, facilitator } = exact;
    const { accepted, payload } = payment;
    if (!matchesRequirements(requirements, accepted)) {
      throw new PaymentRejected("invalid_payment_requirements", "The payment does not match the current price, asset or recipient of this resource.");
    }
    if (!isRecord(payload)) throw new PaymentRejected("invalid_payload", "payload is missing or not an object.", 400);

    const verification = await facilitator.verify(payment, requirements);
    if (!verification.isValid) {
      throw new PaymentRejected(verification.invalidReason ?? "invalid_payload", verification.invalidMessage ?? "The facilitator rejected this payment.");
    }
    /** Verification stays valid until settlement, so a concurrent copy of the same payment must not run the handler again. */
    const claim = await this.claimPayment(exactPaymentKey(payload));
    return {
      granted: true,
      headers: { "Access-Control-Expose-Headers": EXPOSED_HEADERS },
      settle: () => this.settleExact(request, payment, exact, claim),
      release: () => this.releaseClaim(claim),
    };
  }

  /** Settles a claimed payment. A settlement that failed without broadcasting a transaction releases the claim;
      any other outcome keeps it until it lapses, since the transfer may still complete on-chain. */
  private async settleExact(request: Request, payment: PaymentPayload, exact: ExactPaywall, claim: PaymentClaim): Promise<PaywallSettlement> {
    try {
      const result = await exact.facilitator.settle(payment, exact.requirements);
      if (!result.success) {
        if (!result.transaction) await this.releaseClaim(claim);
        throw new PaymentRejected(result.errorReason ?? "unexpected_settle_error", result.errorMessage ?? "The facilitator could not settle this payment.");
      }
      await this.renewClaim(claim);
      const settlement: SettleResponse = {
        success: true,
        transaction: result.transaction,
        network: result.network,
        ...(result.payer ? { payer: result.payer } : {}),
        ...(result.amount ? { amount: result.amount } : {}),
      };
      return { success: true, headers: { [PAYMENT_RESPONSE_HEADER]: encodePaymentResponseHeader(settlement), "Access-Control-Expose-Headers": EXPOSED_HEADERS } };
    } catch (error) {
      return { success: false, response: await this.rejection(request, error) };
    }
  }

  /** Charges credits before the handler runs, so an empty token never runs it; `release` gives the charge back when the handler fails
      or answers 400 or higher, and `settle` keeps it. Only a kept charge reports the balance it left. */
  private async chargeCredits(request: Request, token: string): Promise<PaywallDecision> {
    const charge = await this.client.chargeCredits({
      token,
      amount: this.options.price,
      currency: this.options.currency,
      description: (this.options.description ?? resourceKey(request)).slice(0, MAX_CHARGE_DESCRIPTION_LENGTH),
    });
    return {
      granted: true,
      headers: { "Access-Control-Expose-Headers": EXPOSED_HEADERS },
      settle: async () => ({ success: true, headers: { [CREDIT_BALANCE_HEADER]: charge.balance } }),
      release: () =>
        this.client.refundCreditCharge(charge.id).then(
          () => undefined,
          (error: unknown) => {
            /** The payer keeps the charge until it is refunded, so the id is logged for a manual refund through the API. */
            console.error(`Solverr paywall: credit charge ${charge.id} was not refunded after a failed request: ${errorText(error)}`);
          },
        ),
    };
  }

  /** Turns a failed payment check into a fresh 402 challenge (429 over `challengeLimit`), 400 for a malformed payment, 500 for a refused key or invoice,
      or 503 when Solverr, the facilitator's `/verify` or the claim store cannot be reached. */
  private async rejection(request: Request, error: unknown): Promise<Response> {
    let reason = "unexpected_verify_error";
    let message = "The payment could not be verified.";
    let status = 402;
    if (error instanceof InvoiceCreationRefused) return misconfigured(error);
    if (error instanceof ClaimStoreUnavailableError) {
      console.error(`Solverr paywall: ${error.message}`);
      return this.unavailable();
    }
    if (error instanceof PaymentRejected) {
      ({ reason, message, status } = error);
    } else if (error instanceof FacilitatorUnavailableError) {
      if (error.operation === "verify") return this.unavailable(error);
      reason = "unexpected_settle_error";
      message = "The facilitator did not confirm settlement; the transfer may still complete on-chain.";
    } else if (error instanceof SolverrApiError) {
      /** A 200 whose body is not JSON may still have redeemed or charged, so it is never answered with a new challenge. */
      if (error.status === undefined || error.status >= 500 || error.status === 429 || error.type === "invalid_response") return this.unavailable(error);
      if (error.status === 401 || error.status === 403) {
        return jsonResponse(500, { error: { type: "payment_misconfigured", message: "The Solverr API rejected this server's API key." } });
      }
      reason = error.type === "already_redeemed" || error.type === "invalid_state" ? "invalid_transaction_state" : error.type;
      message = error.status === 404 ? "No invoice or credit account matches this payment." : error.message;
    }
    if (status === 400) return jsonResponse(400, { error: { type: reason, message } });

    const settlement: SettleResponse = { success: false, errorReason: reason, errorMessage: message, transaction: "", network: NO_NETWORK };
    try {
      return await this.challenge(request, message, settlement);
    } catch (challengeError) {
      return challengeError instanceof InvoiceCreationRefused ? misconfigured(challengeError) : this.unavailable(challengeError);
    }
  }

  /** The 503 a payer retries; `cause`, when Solverr or the facilitator could not be reached, goes to the server log. */
  private unavailable(cause?: unknown): Response {
    if (cause !== undefined) console.error(`Solverr paywall: payments are unavailable (answered 503): ${errorText(cause)}`);
    return jsonResponse(503, { error: { type: "payment_unavailable", message: "Payments are temporarily unavailable. Try again shortly." } }, { "Retry-After": "5" });
  }
}

/** The 500 for an invoice Solverr will not create; Solverr's reason goes to the server log, not to the payer. */
function misconfigured(error: InvoiceCreationRefused): Response {
  console.error(`Solverr paywall: Solverr refused to create an invoice (HTTP ${error.cause.status} ${error.cause.type}): ${error.cause.message}`);
  return jsonResponse(500, { error: { type: "payment_misconfigured", message: "This resource cannot take payments right now because of its payment setup." } });
}

/** The value of paywall header `name` over the handler's `existing` one: Access-Control-Expose-Headers keeps the names the handler exposed, others are replaced. */
export function paywallHeaderValue(name: string, value: string, existing: string | null): string {
  if (existing === null || name.toLowerCase() !== "access-control-expose-headers") return value;
  const names = existing.split(",").map((item) => item.trim()).filter(Boolean);
  const exposed = new Set(names.map((item) => item.toLowerCase()));
  for (const item of value.split(",").map((part) => part.trim())) if (item && !exposed.has(item.toLowerCase())) names.push(item);
  return names.join(", ");
}

/** Copies `response` with extra headers; responses from `fetch` have immutable headers. */
function withHeaders(response: Response, headers: Record<string, string>): Response {
  const merged = new Headers(response.headers);
  for (const [name, value] of Object.entries(headers)) merged.set(name, paywallHeaderValue(name, value, merged.get(name)));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged });
}

/** Wraps a Web-standard route handler (Next.js App Router, Hono, Bun, Deno) so each call must be paid.
    Extra handler arguments, such as the Next.js route context, are passed through. */
export function paywall<Args extends unknown[]>(
  options: PaywallOptions,
  handler: (request: Request, ...args: Args) => Response | Promise<Response>,
): (request: Request, ...args: Args) => Promise<Response> {
  const gate = new Paywall(options);
  return async (request, ...args) => {
    const decision = await gate.authorize(request);
    if (!decision.granted) return decision.response;
    let response: Response;
    try {
      response = await handler(request, ...args);
    } catch (error) {
      await decision.release?.();
      throw error;
    }
    if (!decision.settle || response.status >= UNSETTLED_STATUS) {
      /** Awaited so a credit refund finishes before serverless hosts freeze the function after the response. */
      await decision.release?.();
      return withHeaders(response, decision.headers);
    }
    const settlement = await decision.settle();
    if (!settlement.success) {
      await response.body?.cancel();
      return settlement.response;
    }
    return withHeaders(response, { ...decision.headers, ...settlement.headers });
  };
}
