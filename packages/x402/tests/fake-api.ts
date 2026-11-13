import type { SettleResponse, VerifyResponse } from "@x402/core/types";
import type { Invoice } from "../src/merchant-client.js";

export const SOLVERR_URL = "https://solverr.test";
export const FACILITATOR_URL = "https://facilitator.test";
const RESOURCE = "GET /premium";

/** The Solverr merchant API and an x402 facilitator, answered in memory; any other URL fails the test. */
export class FakeApi {
  readonly invoices = new Map<string, Invoice>();
  readonly calls: string[] = [];
  verifyResult: VerifyResponse = { isValid: true, payer: "0xpayer" };
  settleResult: SettleResponse = { success: true, transaction: "0xsettled", network: "eip155:8453", payer: "0xpayer" };
  private created = 0;

  /** Adds a paid, unused invoice for `GET /premium` at 0.05 USD. */
  addPaidInvoice(id: string, changes: Partial<Invoice> = {}): Invoice {
    const invoice: Invoice = { ...this.invoice(id), status: "paid", ...changes };
    this.invoices.set(id, invoice);
    return invoice;
  }

  count(call: string): number {
    return this.calls.filter((made) => made === call).length;
  }

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const path = `${url.origin}${url.pathname}`;
    const invoiceMatch = /^\/api\/v1\/invoices\/([^/]+)(?:\/(redeem))?$/.exec(url.pathname);
    if (path === `${SOLVERR_URL}/api/v1/invoices` && method === "POST") return this.record("create", Response.json(this.createInvoice()));
    if (url.origin === SOLVERR_URL && invoiceMatch && method === "GET" && !invoiceMatch[2]) {
      const invoice = this.invoices.get(decodeURIComponent(invoiceMatch[1]));
      return this.record("get", invoice ? Response.json(invoice) : apiError(404, "not_found"));
    }
    if (url.origin === SOLVERR_URL && invoiceMatch?.[2] === "redeem" && method === "POST") return this.record("redeem", this.redeem(decodeURIComponent(invoiceMatch[1])));
    if (path === `${SOLVERR_URL}/api/v1/credits/charge` && method === "POST") return this.record("charge", Response.json({ id: "chg_1", balance: "4.95" }));
    if (path === `${SOLVERR_URL}/api/v1/credits/charges/chg_1/refund` && method === "POST") return this.record("refund", Response.json({ id: "chg_1", balance: "5.00" }));
    if (path === `${FACILITATOR_URL}/verify` && method === "POST") return this.record("verify", Response.json(this.verifyResult));
    if (path === `${FACILITATOR_URL}/settle` && method === "POST") return this.record("settle", Response.json(this.settleResult));
    throw new Error(`Unexpected request in a test: ${method} ${url.href}`);
  };

  private record(call: string, response: Response): Response {
    this.calls.push(call);
    return response;
  }

  private createInvoice(): Invoice {
    const invoice = this.invoice(`inv_challenge_${++this.created}`);
    this.invoices.set(invoice.id, invoice);
    return invoice;
  }

  private redeem(id: string): Response {
    const invoice = this.invoices.get(id);
    if (!invoice) return apiError(404, "not_found");
    if (invoice.redeemed_at) return apiError(409, "already_redeemed");
    invoice.redeemed_at = new Date().toISOString();
    return Response.json({
      id: `red_${id}`,
      redeemed_at: invoice.redeemed_at,
      payment: { refund_address: "0xrefund", confidential: false, destination_transactions: [{ hash: "0xdelivery" }] },
    });
  }

  private invoice(id: string): Invoice {
    return {
      id,
      mode: "live",
      status: "open",
      amount: "0.05",
      currency: "USD",
      metadata: { solverr_resource: RESOURCE },
      settlement: { asset_id: "nep141:base-usdc.omft.near", symbol: "USDC", blockchain: "base", amount: "0.05", amount_base: "50000" },
      checkout_url: `${SOLVERR_URL}/pay/${id}`,
      redeemed_at: null,
      expires_at: new Date(Date.now() + 900_000).toISOString(),
    };
  }
}

function apiError(status: number, type: string): Response {
  return Response.json({ error: { type, message: `Fake API error: ${type}.` } }, { status });
}
