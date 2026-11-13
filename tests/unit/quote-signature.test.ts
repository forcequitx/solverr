import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import { describe, expect, it, vi } from "vitest";
import { quoteProblem } from "@/lib/oneclick/quote-signature";
import type { QuoteRequest, QuoteResponse } from "@/lib/oneclick/types";

/** A signing key made for this run stands in for the 1Click manager key. */
const signer = vi.hoisted(async () => {
  const { ed25519: curve } = await import("@noble/curves/ed25519.js");
  const { base58: encoding } = await import("@scure/base");
  const { secretKey, publicKey } = curve.keygen();
  return { secretKey, publicKey: `ed25519:${encoding.encode(publicKey)}` };
});

vi.mock("@/lib/oneclick/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/oneclick/constants")>()),
  QUOTE_SIGNING_KEY: (await signer).publicKey,
}));

const request: QuoteRequest = {
  dry: false,
  depositMode: "SIMPLE",
  swapType: "EXACT_OUTPUT",
  slippageTolerance: 100,
  originAsset: "nep141:eth.omft.near",
  depositType: "ORIGIN_CHAIN",
  destinationAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  amount: "25000000",
  refundTo: "0x1111111111111111111111111111111111111111",
  refundType: "ORIGIN_CHAIN",
  recipient: "0x2222222222222222222222222222222222222222",
  recipientType: "DESTINATION_CHAIN",
  deadline: "2026-11-10T12:20:00.000Z",
  referral: "solverr",
};

const quote: QuoteResponse["quote"] = {
  depositAddress: "0x3333333333333333333333333333333333333333",
  amountIn: "10000000000000000",
  amountInFormatted: "0.01",
  amountInUsd: "25.10",
  minAmountIn: "9900000000000000",
  amountOut: "25000000",
  amountOutFormatted: "25",
  amountOutUsd: "25.00",
  minAmountOut: "25000000",
  deadline: "2026-11-13T12:20:00.000Z",
  timeEstimate: 30,
};

/** The message format of one-click-sdk-typescript `quote-signature.ts`, written out here so the check is tested against the spec. */
function signedMessageOf(response: Omit<QuoteResponse, "signature">): Uint8Array {
  const r = response.quoteRequest as unknown as Record<string, unknown>;
  const q = response.quote as unknown as Record<string, unknown>;
  const fields: Record<string, unknown> = { timestamp: response.timestamp };
  for (const key of ["dry", "swapType", "slippageTolerance", "originAsset", "depositType", "destinationAsset", "amount", "refundTo", "refundType", "recipient", "recipientType", "deadline"]) fields[key] = r[key];
  for (const key of ["quoteWaitingTimeMs", "referral", "virtualChainRecipient", "virtualChainRefundRecipient", "customRecipientMsg"]) if (r[key]) fields[key] = r[key];
  for (const key of ["amountIn", "amountInFormatted", "amountInUsd", "minAmountIn", "amountOut", "amountOutFormatted", "amountOutUsd", "minAmountOut"]) fields[key] = q[key];
  if (!r.dry) for (const key of ["depositAddress", "depositMemo", "deadline", "timeWhenInactive", "timeEstimate", "refundFee", "withdrawFee"]) if (q[key]) fields[key] = q[key];
  const json = JSON.stringify(Object.fromEntries(Object.keys(fields).sort().map((key) => [key, fields[key]])));
  return new TextEncoder().encode(base58.encode(sha256(new TextEncoder().encode(json))));
}

async function signedQuote(overrides: Partial<Omit<QuoteResponse, "signature">> = {}, secretKey?: Uint8Array): Promise<QuoteResponse> {
  const unsigned = { correlationId: "corr-1", timestamp: new Date().toISOString(), quoteRequest: request, quote, ...overrides };
  const signature = ed25519.sign(signedMessageOf(unsigned), secretKey ?? (await signer).secretKey);
  return { ...unsigned, signature: `ed25519:${base58.encode(signature)}` };
}

describe("quoteProblem", () => {
  it("accepts a quote signed by the 1Click key, fresh and for the same request", async () => {
    expect(quoteProblem(request, await signedQuote())).toBeNull();
  });

  it("refuses a quote whose amount was changed after signing", async () => {
    const response = await signedQuote();
    expect(quoteProblem(request, { ...response, quote: { ...response.quote, amountIn: "1" } })).toBe("its signature is not valid");
  });

  it("refuses a quote whose deposit address was swapped after signing", async () => {
    const response = await signedQuote();
    expect(quoteProblem(request, { ...response, quote: { ...response.quote, depositAddress: "0x4444444444444444444444444444444444444444" } })).toBe(
      "its signature is not valid",
    );
  });

  it("refuses a quote signed by another key", async () => {
    expect(quoteProblem(request, await signedQuote({}, ed25519.utils.randomSecretKey()))).toBe("its signature is not valid");
  });

  it("refuses a malformed signature without throwing", async () => {
    const response = await signedQuote();
    expect(quoteProblem(request, { ...response, signature: "ed25519:not-base58-0OIl" })).toBe("its signature is not valid");
    expect(quoteProblem(request, { ...response, signature: "" })).toBe("its signature is not valid");
  });

  it("refuses a validly signed quote older than five minutes", async () => {
    const response = await signedQuote({ timestamp: new Date(Date.now() - 6 * 60_000).toISOString() });
    expect(quoteProblem(request, response)).toBe("its timestamp is not current");
    expect(quoteProblem(request, await signedQuote({ timestamp: "not a date" }))).toBe("its timestamp is not current");
  });

  it("refuses a validly signed quote for a different recipient, refund address or amount", async () => {
    expect(quoteProblem(request, await signedQuote({ quoteRequest: { ...request, recipient: "0x5555555555555555555555555555555555555555" } }))).toBe(
      "its recipient differs from the request",
    );
    expect(quoteProblem(request, await signedQuote({ quoteRequest: { ...request, refundTo: "0x6666666666666666666666666666666666666666" } }))).toBe(
      "its refundTo differs from the request",
    );
    expect(quoteProblem(request, await signedQuote({ quoteRequest: { ...request, amount: "1" } }))).toBe("its amount differs from the request");
  });

  it("does not sign deposit fields of a dry quote", async () => {
    const dryRequest = { ...request, dry: true };
    const response = await signedQuote({ quoteRequest: dryRequest });
    expect(quoteProblem(dryRequest, { ...response, quote: { ...response.quote, depositAddress: "0x7777777777777777777777777777777777777777" } })).toBeNull();
  });

  it("ignores confidentiality, which 1Click does not sign", async () => {
    const response = await signedQuote();
    expect(quoteProblem(request, { ...response, quoteRequest: { ...response.quoteRequest, confidentiality: "basic" } })).toBeNull();
  });
});
