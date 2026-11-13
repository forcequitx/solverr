import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import { QUOTE_SIGNING_KEY } from "@/lib/oneclick/constants";
import type { QuoteRequest, QuoteResponse } from "@/lib/oneclick/types";

/** Fields 1Click signs, as in one-click-sdk-typescript `quote-signature.ts`; optional request and deposit fields are dropped when empty.
    `confidentiality` and `depositMode` are not signed. */
const SIGNED_REQUEST_FIELDS = [
  "dry",
  "swapType",
  "slippageTolerance",
  "originAsset",
  "depositType",
  "destinationAsset",
  "amount",
  "refundTo",
  "refundType",
  "recipient",
  "recipientType",
  "deadline",
] as const;
const SIGNED_OPTIONAL_REQUEST_FIELDS = ["quoteWaitingTimeMs", "referral", "virtualChainRecipient", "virtualChainRefundRecipient", "customRecipientMsg"] as const;
const SIGNED_AMOUNT_FIELDS = ["amountIn", "amountInFormatted", "amountInUsd", "minAmountIn", "amountOut", "amountOutFormatted", "amountOutUsd", "minAmountOut"] as const;
const SIGNED_DEPOSIT_FIELDS = ["depositAddress", "depositMemo", "deadline", "timeWhenInactive", "timeEstimate", "refundFee", "withdrawFee"] as const;

function pick(source: Record<string, unknown>, fields: readonly string[], dropEmpty: boolean): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field, dropEmpty ? source[field] || undefined : source[field]]));
}

/** JSON with keys in sorted order and undefined values left out, as `json-stable-stringify` writes a flat object. */
function stableJson(value: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])));
}

/** The message 1Click signs: the Base58 SHA-256 of the signed fields and the response timestamp, as UTF-8 text. */
function signedMessage(response: QuoteResponse): Uint8Array {
  const request = response.quoteRequest as unknown as Record<string, unknown>;
  const quote = response.quote as unknown as Record<string, unknown>;
  const fields = {
    ...pick(request, SIGNED_REQUEST_FIELDS, false),
    ...pick(request, SIGNED_OPTIONAL_REQUEST_FIELDS, true),
    ...pick(quote, SIGNED_AMOUNT_FIELDS, false),
    ...(request.dry ? {} : pick(quote, SIGNED_DEPOSIT_FIELDS, true)),
    timestamp: response.timestamp,
  };
  return new TextEncoder().encode(base58.encode(sha256(new TextEncoder().encode(stableJson(fields)))));
}

const decodeKey = (value: string) => base58.decode(value.replace(/^ed25519:/, ""));

/** Whether the quote carries a valid signature by the 1Click manager key over its request, amounts and deposit address. */
function verifyQuoteSignature(response: QuoteResponse): boolean {
  try {
    return ed25519.verify(decodeKey(response.signature), signedMessage(response), decodeKey(QUOTE_SIGNING_KEY));
  } catch {
    return false;
  }
}

/** Request fields that decide who pays what to whom; the signed copy in the answer must equal what was sent. */
const MATCHED_REQUEST_FIELDS = ["dry", "swapType", "originAsset", "destinationAsset", "amount", "refundTo", "recipient"] as const;
/** How far the signed timestamp may be from this server's clock, so an old signed quote cannot be passed off as new. */
const MAX_TIMESTAMP_SKEW_MS = 5 * 60_000;

/** Why a real quote answer cannot be trusted for `sent`, or null when it is signed, fresh and for the same request. */
export function quoteProblem(sent: QuoteRequest, response: QuoteResponse): string | null {
  if (!verifyQuoteSignature(response)) return "its signature is not valid";
  const signedAt = Date.parse(response.timestamp);
  if (!Number.isFinite(signedAt) || Math.abs(Date.now() - signedAt) > MAX_TIMESTAMP_SKEW_MS) return "its timestamp is not current";
  const changed = MATCHED_REQUEST_FIELDS.find((field) => response.quoteRequest[field] !== sent[field]);
  return changed ? `its ${changed} differs from the request` : null;
}
