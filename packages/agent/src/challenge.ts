import {
  SOLVERR_SCHEME,
  X402_VERSION,
  decodePaymentRequiredHeader,
  readHeader,
  secureUrl,
  type SolverrRequirementExtra,
  type PaymentRequired,
  type PaymentRequirements,
} from "solverr-x402";
import { PaymentError } from "./errors.js";

/** A validated `solverr` payment requirement from a 402 response. */
export interface SolverrChallenge {
  paymentRequired: PaymentRequired;
  requirement: PaymentRequirements;
  extra: SolverrRequirementExtra;
  tokensUrl: string;
}

const INVOICE_ENDPOINT = /^(?<root>(?:\/[^/]+)*?\/api\/v1)\/invoices\/(?<id>[^/]+)\/(?<action>quote|deposit|status)$/;

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** A percent-decoded path segment, or `undefined` when its escapes are malformed. */
function decodedSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

function parseEndpoint(value: string, invoiceId: string, action: string): { origin: string; root: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PaymentError("invalid_challenge", `The payment challenge has an invalid ${action} URL.`);
  }
  try {
    secureUrl(url.href, `${action} URL`);
  } catch {
    throw new PaymentError("untrusted_gateway", `The payment challenge's ${action} URL must use https.`);
  }
  const match = INVOICE_ENDPOINT.exec(url.pathname);
  if (!match?.groups || decodedSegment(match.groups.id) !== invoiceId || match.groups.action !== action || url.search || url.hash) {
    throw new PaymentError("invalid_challenge", `The payment challenge's ${action} URL does not point to invoice ${invoiceId}.`);
  }
  return { origin: url.origin, root: `${url.origin}${match.groups.root}` };
}

/** Returns the `solverr` requirement of a `PAYMENT-REQUIRED` header; `undefined` when the header is missing, undecodable or offers none.
    An incomplete requirement, bad endpoint URLs or an untrusted gateway throw `PaymentError`. */
export function parseChallenge(header: string | null, trustedGateways: readonly string[]): SolverrChallenge | undefined {
  const paymentRequired = readHeader(header, decodePaymentRequiredHeader);
  if (!paymentRequired || paymentRequired.x402Version !== X402_VERSION || !Array.isArray(paymentRequired.accepts)) return undefined;
  const requirement = paymentRequired.accepts.find((entry) => entry?.scheme === SOLVERR_SCHEME);
  if (!requirement) return undefined;

  const extra = requirement.extra as Partial<SolverrRequirementExtra> | undefined;
  const settlement = extra?.settlement;
  if (
    !extra ||
    !isText(extra.invoice_id) ||
    !isText(extra.mode) ||
    !isText(extra.quote_url) ||
    !isText(extra.deposit_url) ||
    !isText(extra.status_url) ||
    !isText(extra.price) ||
    !isText(extra.currency) ||
    !isText(extra.expires_at) ||
    Number.isNaN(Date.parse(extra.expires_at)) ||
    !settlement ||
    !isText(settlement.asset_id) ||
    !isText(settlement.symbol) ||
    !isText(settlement.blockchain) ||
    !isText(settlement.amount)
  ) {
    throw new PaymentError("invalid_challenge", "The payment challenge is missing invoice details.");
  }

  const endpoints = [
    parseEndpoint(extra.quote_url, extra.invoice_id, "quote"),
    parseEndpoint(extra.deposit_url, extra.invoice_id, "deposit"),
    parseEndpoint(extra.status_url, extra.invoice_id, "status"),
  ];
  if (endpoints.some((endpoint) => endpoint.root !== endpoints[0].root)) {
    throw new PaymentError("invalid_challenge", "The payment challenge's URLs point to different servers.");
  }
  const gatewayOrigin = endpoints[0].origin;
  if (!trustedGateways.some((trusted) => new URL(trusted).origin === gatewayOrigin)) {
    throw new PaymentError("untrusted_gateway", `The payment gateway ${gatewayOrigin} is not in the trusted gateway list.`);
  }

  return { paymentRequired, requirement, extra: extra as SolverrRequirementExtra, tokensUrl: `${endpoints[0].root}/tokens` };
}
