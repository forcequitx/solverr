import { requestJson } from "solverr-x402";

/** One coin from `GET /api/v1/tokens`. */
export interface GatewayToken {
  asset_id: string;
  symbol: string;
  blockchain: string;
  decimals: number;
  price_usd: number;
  contract_address: string | null;
}

/** Payment attempt returned by `POST /api/v1/invoices/:id/quote`. */
export interface GatewayQuote {
  id: string;
  coin: { asset_id: string; symbol: string; blockchain: string; decimals: number };
  amount_in: string;
  amount_in_base: string;
  deposit_address: string;
  deposit_memo: string | null;
  refund_address: string;
  deadline: string;
}

/** Public checkout status from `GET /api/v1/invoices/:id/status`. */
export interface GatewayStatus {
  status: string;
  payment: (GatewayQuote & { status: string }) | null;
}

const RETRIES = 2;

/** Public Solverr API calls the agent makes for one invoice. URLs come from a validated challenge. */
export class GatewayClient {
  constructor(private readonly timeoutMs: number) {}

  async listTokens(tokensUrl: string): Promise<GatewayToken[]> {
    const body = await requestJson<{ data: GatewayToken[] }>({ method: "GET", url: tokensUrl, timeoutMs: this.timeoutMs, retries: RETRIES });
    return body.data;
  }

  /** Asks for a deposit address; retried once, since the server returns the same open quote for the same coin and refund address. */
  requestQuote(quoteUrl: string, originAsset: string, refundAddress: string): Promise<GatewayQuote> {
    return requestJson({ method: "POST", url: quoteUrl, body: { origin_asset: originAsset, refund_address: refundAddress }, timeoutMs: this.timeoutMs, retries: 1 });
  }

  /** Reports the transfer for the payment it was sent to, so a newer address on the invoice cannot take the report. */
  reportDeposit(depositUrl: string, txHash: string, paymentId: string): Promise<GatewayStatus> {
    return requestJson({ method: "POST", url: depositUrl, body: { tx_hash: txHash, payment_id: paymentId }, timeoutMs: this.timeoutMs, retries: RETRIES });
  }

  getStatus(statusUrl: string): Promise<GatewayStatus> {
    return requestJson({ method: "GET", url: statusUrl, timeoutMs: this.timeoutMs, retries: RETRIES });
  }
}
