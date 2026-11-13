import { SolverrApiError } from "solverr-x402";
import { formatUnits } from "viem";
import type { WalletAsset } from "./assets.js";
import type { ChainWallet } from "./chains/chain-wallet.js";
import type { SolverrChallenge } from "./challenge.js";
import { rankPaymentOptions, type PaymentOption } from "./coin-selection.js";
import { MAX_QUOTE_ATTEMPTS, MAX_QUOTE_OVER_ESTIMATE, MIN_QUOTE_VALIDITY_MS, STATUS_POLL_INTERVAL_MS } from "./config.js";
import { PaymentError, errorSummary } from "./errors.js";
import type { GatewayClient, GatewayQuote } from "./gateway.js";
import { assertHostAllowed, enforceLimits, type SpendingLimits } from "./limits.js";
import type { SpendChanges, SpendCheck, SpendEntry, SpendLog } from "./spend-log.js";
import { sleep } from "./timeout.js";

interface PayerOptions {
  wallets: readonly ChainWallet[];
  assets: readonly WalletAsset[];
  spendLog: SpendLog;
  gateway: GatewayClient;
  limits: () => SpendingLimits;
  paymentTimeoutMs: number;
}

/** Invoice states the agent's own quote ending sets, after which waiting cannot lead to `paid`. `expired` is not one:
    a deposit sent near the deadline still moves the invoice to `detected` and then `paid`. */
const FAILED_INVOICE_STATES = new Set(["underpaid", "refunded", "failed"]);
/** Allowance for rounding in the USD comparison of a quote against its estimate. */
const QUOTE_TOLERANCE_USD = 0.01;

/** Pays `solverr` invoices one at a time: limits, coin choice, quote checks, transfer, and confirmation. */
export class Payer {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: PayerOptions) {}

  /** Pays the invoice in `challenge`, one payment at a time so limit checks never race.
      An aborted `signal` stops the payment at any step before the transfer; once the transfer starts it is not stopped. */
  pay(resourceUrl: URL, challenge: SolverrChallenge, signal?: AbortSignal): Promise<void> {
    const run = () => this.payInvoice(resourceUrl, challenge, signal);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async payInvoice(resourceUrl: URL, challenge: SolverrChallenge, signal: AbortSignal | undefined): Promise<void> {
    const { extra } = challenge;
    const { spendLog, gateway } = this.options;
    const hostname = resourceUrl.hostname;

    signal?.throwIfAborted();
    assertHostAllowed(this.options.limits(), hostname);
    if (extra.mode !== "live") {
      throw new PaymentError("test_invoice", "This is a test invoice. Test invoices come from the Solverr demo store and cannot be paid on-chain.");
    }
    if (Date.parse(extra.expires_at) - Date.now() < MIN_QUOTE_VALIDITY_MS) throw new PaymentError("invoice_expired", "The invoice expires too soon to pay safely.");

    const tokens = await gateway.listTokens(challenge.tokensUrl);
    const settlementToken = tokens.find((token) => token.asset_id === extra.settlement.asset_id);
    if (!settlementToken?.price_usd) throw new PaymentError("invalid_challenge", "The invoice's settlement coin has no price from the gateway.");
    const settlementUsd = Number(extra.settlement.amount) * settlementToken.price_usd;
    const amountUsd = extra.currency === "USD" ? Math.max(settlementUsd, Number(extra.price)) : settlementUsd;
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new PaymentError("invalid_challenge", "The invoice amount is not valid.");

    const entry = await spendLog.reserve(
      { url: resourceUrl.toString(), host: hostname, invoice_id: extra.invoice_id, amount_usd: amountUsd, status: "reserved" },
      (spentLast24hUsd) => enforceLimits(this.options.limits(), { hostname, amountUsd, spentLast24hUsd }),
    );

    try {
      const { options, skipped } = await rankPaymentOptions({ wallets: this.options.wallets, assets: this.options.assets, tokens, settlement: extra.settlement, amountUsd });
      if (options.length === 0) {
        throw new PaymentError("no_funds", `No coin in this wallet covers about $${amountUsd.toFixed(2)}.${skipped.length ? ` Checked: ${skipped.join("; ")}.` : ""}`);
      }

      const refusals: string[] = [];
      for (const option of options.slice(0, MAX_QUOTE_ATTEMPTS)) {
        signal?.throwIfAborted();
        let quote: GatewayQuote;
        try {
          quote = await gateway.requestQuote(extra.quote_url, option.asset.asset_id, option.wallet.address);
        } catch (error) {
          if (error instanceof SolverrApiError && error.status === 422) {
            refusals.push(`${option.asset.symbol} on ${option.asset.blockchain}: ${error.message}`);
            continue;
          }
          throw error;
        }
        const { amount, quotedUsd } = verifyQuote(quote, option, amountUsd);
        await this.record(entry, { amount_usd: quotedUsd, asset_id: option.asset.asset_id, blockchain: option.asset.blockchain, amount_base: amount.toString() }, (spentLast24hUsd) =>
          enforceLimits(this.options.limits(), { hostname, amountUsd: quotedUsd, spentLast24hUsd }),
        );
        signal?.throwIfAborted();
        return await this.transferAndConfirm(entry, option, quote, amount, challenge);
      }
      throw new PaymentError("quote_unavailable", `No quote was available. ${refusals.join(" ")}`.trim());
    } catch (error) {
      const fundsSent = entry.status !== "reserved" || (error instanceof PaymentError && error.fundsSent);
      if (entry.status === "reserved") {
        /** A failed write leaves the entry reserved, which still counts toward the daily limit. */
        await this.record(entry, { status: fundsSent ? "failed" : "aborted", error: errorSummary(error) }).catch(() => undefined);
      }
      throw fundsSent ? sentPaymentError(error, extra.invoice_id) : error;
    }
  }

  /** Mirrors `changes` on `entry` before saving, so the error path knows funds left even when the write fails. */
  private async record(entry: SpendEntry, changes: SpendChanges, check?: SpendCheck): Promise<void> {
    Object.assign(entry, changes);
    await this.options.spendLog.update(entry.id, changes, check);
  }

  private async transferAndConfirm(entry: SpendEntry, option: PaymentOption, quote: GatewayQuote, amount: bigint, challenge: SolverrChallenge): Promise<void> {
    const { gateway } = this.options;
    const { extra } = challenge;

    const transfer = await option.wallet.transfer(option.asset, quote.deposit_address, amount);
    /** From here on the entry counts toward the daily limit whatever its saved status, so a failed write does not stop the payment. */
    await this.record(entry, { status: "sent", tx_hash: transfer.hash }).catch(() => undefined);

    try {
      await gateway.reportDeposit(extra.deposit_url, transfer.hash, quote.id);
    } catch {
      /** Reporting only speeds up detection; the gateway also watches the deposit address. */
    }

    const deadline = Date.now() + this.options.paymentTimeoutMs;
    let lastStatus = "unknown";
    while (Date.now() < deadline) {
      try {
        lastStatus = (await gateway.getStatus(extra.status_url)).status;
      } catch (error) {
        if (!(error instanceof SolverrApiError)) throw error;
      }
      if (lastStatus === "paid") {
        await this.record(entry, { status: "paid" }).catch(() => undefined);
        return;
      }
      if (FAILED_INVOICE_STATES.has(lastStatus)) {
        await this.record(entry, { status: "failed", error: `Invoice ${lastStatus}` }).catch(() => undefined);
        throw new PaymentError("payment_failed", `Sent ${transfer.hash}, but the invoice is ${lastStatus}. Any refund goes to ${option.wallet.address}.`, true, extra.invoice_id);
      }
      await sleep(STATUS_POLL_INTERVAL_MS);
    }
    throw new PaymentError(
      "payment_timeout",
      `Sent ${transfer.hash}, but invoice ${extra.invoice_id} was still "${lastStatus}" after ${Math.round(this.options.paymentTimeoutMs / 1000)} s. Check ${extra.status_url} before paying again.`,
      true,
      extra.invoice_id,
    );
  }
}

/** The error for a payment whose funds may have left the wallet, carrying the invoice ID so the caller never pays it twice. */
function sentPaymentError(error: unknown, invoiceId: string): PaymentError {
  if (error instanceof PaymentError && error.fundsSent) return new PaymentError(error.code, error.message, true, invoiceId);
  return new PaymentError("payment_unconfirmed", `Funds were sent for invoice ${invoiceId}, but the payment could not be confirmed: ${errorSummary(error)}`, true, invoiceId);
}

/** Checks a quote against the chosen coin, the wallet and the estimate before any funds move; returns the exact amount and its USD value. */
function verifyQuote(quote: GatewayQuote, option: PaymentOption, estimateUsd: number): { amount: bigint; quotedUsd: number } {
  const mismatch = (reason: string) => new PaymentError("quote_mismatch", `The quote was refused: ${reason}.`);
  if (quote.deposit_address?.startsWith("TEST-")) {
    throw new PaymentError("test_invoice", "This invoice uses a test deposit address. Test invoices cannot be paid on-chain.");
  }
  if (quote.coin?.asset_id !== option.asset.asset_id) throw mismatch("it is for a different coin");
  if (quote.refund_address?.toLowerCase() !== option.wallet.address.toLowerCase()) throw mismatch("its refund address is not this wallet");
  if (!option.wallet.isValidRecipient(quote.deposit_address)) throw mismatch(`the deposit address is not a valid ${option.asset.blockchain} address`);
  if (quote.deposit_memo) throw mismatch("it needs a memo, which this wallet cannot attach");
  if (!/^\d{1,78}$/.test(quote.amount_in_base ?? "")) throw mismatch("its amount is malformed");
  const amount = BigInt(quote.amount_in_base);
  if (amount <= 0n) throw mismatch("its amount is zero");
  if (amount > option.balance) throw new PaymentError("no_funds", `The quote needs ${quote.amount_in} ${option.asset.symbol}, more than this wallet holds.`);
  if (Date.parse(quote.deadline) - Date.now() < MIN_QUOTE_VALIDITY_MS) throw mismatch("it expires too soon");

  const quotedUsd = Number(formatUnits(amount, option.asset.decimals)) * option.priceUsd;
  if (quotedUsd > estimateUsd * (1 + MAX_QUOTE_OVER_ESTIMATE) + QUOTE_TOLERANCE_USD) {
    throw mismatch(`it costs about $${quotedUsd.toFixed(4)}, far above the expected $${estimateUsd.toFixed(4)}`);
  }
  return { amount, quotedUsd };
}
