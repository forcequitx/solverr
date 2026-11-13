import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { exactRequirements } from "../src/exact.js";
import { encodePaymentSignatureHeader } from "../src/index.js";
import { FACILITATOR_URL } from "./fake-api.js";

export const EXACT = { payTo: "0x1111111111111111111111111111111111111111", facilitatorUrl: FACILITATOR_URL };

function signature(payment: PaymentPayload): Record<string, string> {
  return { "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payment) };
}

/** The PAYMENT-SIGNATURE header of a `solverr` payment for `invoiceId`. */
export function invoicePayment(invoiceId: string): Record<string, string> {
  return signature({
    x402Version: 2,
    accepted: { scheme: "solverr", network: "eip155:8453", amount: "50000", asset: "nep141:base-usdc.omft.near", payTo: invoiceId, maxTimeoutSeconds: 899, extra: {} },
    payload: { invoice_id: invoiceId },
  });
}

/** The PAYMENT-SIGNATURE header of an `exact` payment identified by `nonce` that claims `accepted`, by default 0.05 USDC to `EXACT.payTo`. */
export function exactPayment(nonce: string, accepted: PaymentRequirements = exactRequirements("0.05", "USD", EXACT)): Record<string, string> {
  const authorization = { from: "0xPayer", to: accepted.payTo, value: accepted.amount, validAfter: "0", validBefore: "9999999999", nonce };
  return signature({ x402Version: 2, accepted, payload: { signature: "0xsignature", authorization } });
}
