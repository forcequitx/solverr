import { HTTPFacilitatorClient, type FacilitatorConfig } from "@x402/core/http";
import { SettleError, VerifyError, type PaymentPayload, type PaymentRequirements, type SettleResponse, type VerifyResponse } from "@x402/core/types";
import { RETRY_BASE_DELAY_MS, sleep } from "./http.js";

const DEFAULT_FACILITATOR_TIMEOUT_MS = 30_000;
const VERIFY_RETRIES = 2;
/** Non-terminal settle result: the transfer was broadcast but not yet confirmed. */
const SETTLEMENT_PENDING = "settlement_pending";

/** The facilitator could not be reached or answered with something other than a verify or settle result. */
export class FacilitatorUnavailableError extends Error {
  constructor(readonly operation: "verify" | "settle") {
    super(`The x402 facilitator did not complete ${operation}.`);
    this.name = "FacilitatorUnavailableError";
  }
}

interface FacilitatorOptions {
  url: string;
  createAuthHeaders?: FacilitatorConfig["createAuthHeaders"];
  timeoutMs?: number;
}

/** x402 facilitator `/verify` and `/settle` calls with timeouts and bounded retries. */
export class Facilitator {
  private readonly client: HTTPFacilitatorClient;

  constructor(options: FacilitatorOptions) {
    this.client = new HTTPFacilitatorClient({
      url: options.url,
      createAuthHeaders: options.createAuthHeaders,
      timeoutMs: options.timeoutMs ?? DEFAULT_FACILITATOR_TIMEOUT_MS,
    });
  }

  /** Verification is read-only, so transport failures are retried. */
  async verify(payment: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    for (let attempt = 0; attempt <= VERIFY_RETRIES; attempt++) {
      if (attempt > 0) await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
      try {
        return await this.client.verify(payment, requirements);
      } catch (error) {
        if (error instanceof VerifyError) {
          return { isValid: false, invalidReason: error.invalidReason ?? "unexpected_verify_error", invalidMessage: error.invalidMessage, payer: error.payer };
        }
      }
    }
    throw new FacilitatorUnavailableError("verify");
  }

  /** Settlement moves funds, so it is repeated only once and only for a broadcast transfer that is still pending. */
  async settle(payment: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    const result = await this.settleOnce(payment, requirements);
    if (!result.success && result.errorReason === SETTLEMENT_PENDING && result.transaction) return this.settleOnce(payment, requirements);
    return result;
  }

  private async settleOnce(payment: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    try {
      return await this.client.settle(payment, requirements);
    } catch (error) {
      if (error instanceof SettleError) {
        return {
          success: false,
          errorReason: error.errorReason ?? "unexpected_settle_error",
          errorMessage: error.errorMessage,
          payer: error.payer,
          transaction: error.transaction ?? "",
          network: error.network ?? requirements.network,
        };
      }
      throw new FacilitatorUnavailableError("settle");
    }
  }
}
