import { EXACT_SCHEME, encodePaymentRequiredHeader } from "solverr-x402";
import { describe, expect, it } from "vitest";
import { parseChallenge } from "../src/challenge.js";
import { PaymentError } from "../src/errors.js";
import { GATEWAY, INVOICE_ID, challengeHeader, paymentRequired, solverrExtra } from "./fixtures.js";

const TRUSTED = [GATEWAY];

function refusal(header: string, trusted: readonly string[] = TRUSTED): PaymentError {
  try {
    parseChallenge(header, trusted);
  } catch (error) {
    expect(error).toBeInstanceOf(PaymentError);
    return error as PaymentError;
  }
  throw new Error("parseChallenge accepted the challenge");
}

const invoiceUrl = (action: string, origin = GATEWAY, id = INVOICE_ID) => `${origin}/api/v1/invoices/${id}/${action}`;

describe("parseChallenge", () => {
  it("returns the solverr requirement and the gateway's tokens URL", () => {
    const challenge = parseChallenge(challengeHeader(), TRUSTED);
    expect(challenge?.extra.invoice_id).toBe(INVOICE_ID);
    expect(challenge?.requirement.scheme).toBe("solverr");
    expect(challenge?.tokensUrl).toBe(`${GATEWAY}/api/v1/tokens`);
  });

  it("matches a trusted gateway by origin, ignoring its path", () => {
    expect(parseChallenge(challengeHeader(), [`${GATEWAY}/some/path`])).toBeDefined();
  });

  it("keeps a path prefix in front of /api/v1 for the tokens URL", () => {
    const root = `${GATEWAY}/solverr/api/v1/invoices/${INVOICE_ID}`;
    const header = challengeHeader(solverrExtra({ quote_url: `${root}/quote`, deposit_url: `${root}/deposit`, status_url: `${root}/status` }));
    expect(parseChallenge(header, TRUSTED)?.tokensUrl).toBe(`${GATEWAY}/solverr/api/v1/tokens`);
  });

  it("reads a header written in URL-safe base64", () => {
    const urlSafe = challengeHeader().replace(/\+/g, "-").replace(/\//g, "_");
    expect(parseChallenge(urlSafe, TRUSTED)?.extra.invoice_id).toBe(INVOICE_ID);
  });

  it("accepts a percent-encoded invoice ID in the endpoint path", () => {
    const header = challengeHeader(solverrExtra({ quote_url: invoiceUrl("quote", GATEWAY, "inv%5F1") }));
    expect(parseChallenge(header, TRUSTED)).toBeDefined();
  });

  it("returns undefined for a missing, undecodable or non-JSON header", () => {
    expect(parseChallenge(null, TRUSTED)).toBeUndefined();
    expect(parseChallenge("", TRUSTED)).toBeUndefined();
    expect(parseChallenge("not base64 at all!", TRUSTED)).toBeUndefined();
    expect(parseChallenge(Buffer.from("{oops").toString("base64"), TRUSTED)).toBeUndefined();
  });

  it("returns undefined for another x402 version or no solverr requirement", () => {
    expect(parseChallenge(encodePaymentRequiredHeader({ ...paymentRequired(), x402Version: 1 } as never), TRUSTED)).toBeUndefined();
    expect(parseChallenge(challengeHeader(solverrExtra(), EXACT_SCHEME), TRUSTED)).toBeUndefined();
    expect(parseChallenge(encodePaymentRequiredHeader({ ...paymentRequired(), accepts: "none" } as never), TRUSTED)).toBeUndefined();
  });

  it.each([
    ["invoice_id", { invoice_id: "" }],
    ["mode", { mode: undefined }],
    ["status_url", { status_url: undefined }],
    ["price", { price: "" }],
    ["expires_at that is not a date", { expires_at: "tomorrow" }],
    ["settlement", { settlement: undefined }],
    ["settlement amount", { settlement: { asset_id: "a", symbol: "USDC", blockchain: "base" } }],
  ])("refuses a requirement without a valid %s", (_name, overrides) => {
    const error = refusal(challengeHeader({ ...solverrExtra(), ...overrides }));
    expect(error.code).toBe("invalid_challenge");
    expect(error.fundsSent).toBe(false);
  });

  it("refuses a requirement without extra", () => {
    const header = encodePaymentRequiredHeader({ ...paymentRequired(), accepts: [{ ...paymentRequired().accepts[0], extra: undefined }] } as never);
    expect(refusal(header).code).toBe("invalid_challenge");
  });

  it("refuses a gateway that is not trusted", () => {
    expect(refusal(challengeHeader(), ["https://other.example.com"]).code).toBe("untrusted_gateway");
  });

  it("refuses non-https endpoint URLs as an untrusted gateway", () => {
    const header = challengeHeader(solverrExtra({ quote_url: invoiceUrl("quote", "http://pay.example.com") }));
    expect(refusal(header, [...TRUSTED, "http://pay.example.com"]).code).toBe("untrusted_gateway");
  });

  it("allows http only on localhost, and only when that gateway is trusted", () => {
    const local = "http://localhost:3000";
    const header = challengeHeader(solverrExtra({ quote_url: invoiceUrl("quote", local), deposit_url: invoiceUrl("deposit", local), status_url: invoiceUrl("status", local) }));
    expect(parseChallenge(header, [local])?.tokensUrl).toBe(`${local}/api/v1/tokens`);
    expect(refusal(header).code).toBe("untrusted_gateway");
  });

  it.each([
    ["an unparsable URL", { quote_url: "not a url" }],
    ["another invoice", { quote_url: invoiceUrl("quote", GATEWAY, "inv_2") }],
    ["the wrong action", { quote_url: invoiceUrl("deposit") }],
    ["a query string", { status_url: `${invoiceUrl("status")}?x=1` }],
    ["a fragment", { deposit_url: `${invoiceUrl("deposit")}#x` }],
    ["a malformed escape", { quote_url: invoiceUrl("quote", GATEWAY, "%E0%A4%A") }],
    ["a path outside /api/v1/invoices", { quote_url: `${GATEWAY}/v2/invoices/${INVOICE_ID}/quote` }],
  ])("refuses an endpoint URL with %s", (_name, overrides) => {
    expect(refusal(challengeHeader(solverrExtra(overrides))).code).toBe("invalid_challenge");
  });

  it("refuses endpoints that point to different servers", () => {
    const header = challengeHeader(solverrExtra({ status_url: invoiceUrl("status", "https://other.example.com") }));
    expect(refusal(header, [...TRUSTED, "https://other.example.com"]).code).toBe("invalid_challenge");
  });

  it("refuses endpoints under different path prefixes on the same server", () => {
    const header = challengeHeader(solverrExtra({ status_url: `${GATEWAY}/x/api/v1/invoices/${INVOICE_ID}/status` }));
    expect(refusal(header).code).toBe("invalid_challenge");
  });
});
