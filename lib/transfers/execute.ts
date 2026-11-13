import { type Merchant, Prisma, type Transfer } from "@/generated/prisma/client";
import { ApiError } from "@/lib/api/errors";
import { chainForToken } from "@/lib/chains/registry";
import { restoreTopUpCredits } from "@/lib/credits/credits";
import { getDb } from "@/lib/db";
import { reportError } from "@/lib/error-reports";
import { formatUtcDateTime } from "@/lib/format";
import { errorMessage, logger } from "@/lib/logger";
import { createAlert } from "@/lib/merchants/alerts";
import { toBaseUnits } from "@/lib/money";
import { fetchStatus, isRefusal, OneClickError, oneClickMessage, requestQuote, submitDeposit } from "@/lib/oneclick/client";
import { REFERRAL } from "@/lib/oneclick/constants";
import { findToken } from "@/lib/oneclick/tokens";
import type { OneClickToken, QuoteRequest, QuoteResponse, StatusResponse } from "@/lib/oneclick/types";
import { QUOTE_TTL_MS, routeTerms } from "@/lib/payments/quote";
import { lockInvoice, lockMerchantShared } from "@/lib/row-locks";
import { resizeSplitPayouts } from "@/lib/splits/splits";
import { DAY_MS, HOUR_MS } from "@/lib/time";
import { KIND_LABELS, SPLIT_ON_HOLD, splitOnHold } from "@/lib/transfers/kinds";
import { checkDirectTransfer, isContractWallet, isTransactionHash } from "@/lib/transfers/onchain";
import { serializeTransfer } from "@/lib/transfers/serialize";
import type { PaymentInstruction } from "@/lib/wallets/payment-instruction";
import { enqueueWebhook } from "@/lib/webhooks/events";
import { BATCH_BUDGET_MS, CLAIM_LEASE_MS } from "@/lib/worker/claims";

const log = logger.child({ module: "transfer" });

const POLL_MS = 15_000;
const POLL_BATCH = 20;
/** How long a swap with no deposit is watched past its requested deadline; 1Click refunds later deposits, so it can then fail and be resent. */
const DEPOSIT_GRACE_MS = HOUR_MS;
/** How long a direct transfer's reported transaction may stay unfound, or uncheckable, before the transfer fails. */
const DIRECT_TX_WATCH_MS = DAY_MS;

/** When a swap's deposit address stops being watched: the deadline it asked 1Click for, plus DEPOSIT_GRACE_MS. */
function depositWindowEnd(transfer: Transfer): Date | null {
  const deadline = (transfer.rawQuote as QuoteResponse | null)?.quoteRequest.deadline;
  return deadline ? new Date(new Date(deadline).getTime() + DEPOSIT_GRACE_MS) : null;
}

function depositWindowClosed(transfer: Transfer): boolean {
  const end = depositWindowEnd(transfer);
  return !!end && end.getTime() < Date.now();
}

/** Whether a direct transfer's reported transaction has been watched for longer than DIRECT_TX_WATCH_MS. */
const directWatchOver = (transfer: Transfer) => !!transfer.txReportedAt && Date.now() - transfer.txReportedAt.getTime() > DIRECT_TX_WATCH_MS;

/** Frees a transaction hash held by a failed or canceled transfer (hashes are unique), so a mistaken or hostile report on one never blocks the real one. */
function releaseEndedTxHash(db: Prisma.TransactionClient, txHash: string) {
  return db.transfer.updateMany({ where: { txHash, status: { in: ["failed", "canceled"] } }, data: { txHash: null } });
}

/** Completes the transfer only if its status is still the one read, so two requests or the worker cannot complete it twice. */
async function complete(tx: Prisma.TransactionClient, transfer: Transfer, merchant: Merchant, txHash: string | null) {
  const refundInvoiceId = transfer.kind === "refund" ? transfer.invoiceId : null;
  if (refundInvoiceId) await lockInvoice(tx, refundInvoiceId);
  if (txHash && txHash !== transfer.txHash) await releaseEndedTxHash(tx, txHash);
  const { count } = await tx.transfer.updateMany({
    where: { id: transfer.id, status: transfer.status },
    data: { status: "completed", txHash: txHash ?? transfer.txHash, nextPollAt: null },
  });
  if (count === 0) return;
  /** A finished refund settles what is kept, so split payouts held at nothing are canceled for good. */
  if (refundInvoiceId) await resizeSplitPayouts(tx, refundInvoiceId);
  const done = await tx.transfer.findUniqueOrThrow({ where: { id: transfer.id } });
  /** Earn withdrawals move the merchant's own funds and have no webhook event. */
  if (done.kind === "withdrawal") return;
  const type = done.kind === "refund" ? "refund.completed" : "payout.completed";
  await enqueueWebhook(tx, merchant, "live", type, { [done.kind]: serializeTransfer(done) });
}

async function load(transferId: string, merchantId: string) {
  const transfer = await getDb().transfer.findFirst({ where: { id: transferId, merchantId }, include: { merchant: true } });
  if (!transfer) throw new ApiError(404, "not_found", "No transfer with this id.");
  return transfer;
}

type PreparedTransfer = { preparedBefore: true } | { preparedBefore?: false; instruction: PaymentInstruction };

/** The widest price movement a transfer swap accepts, in basis points; a refused tighter quote is retried once at this value. */
const MAX_TRANSFER_SLIPPAGE_BPS = 100;

/** Quotes the swap with the payment route terms, slippage capped at MAX_TRANSFER_SLIPPAGE_BPS; only a 400 is retried, once, at the cap. */
async function quoteTransfer(transfer: Transfer, source: OneClickToken, amountBase: string, recipient: string, refundTo: string): Promise<QuoteResponse> {
  const terms = routeTerms(source, await findToken(transfer.destinationAsset));
  const request: QuoteRequest = {
    dry: false,
    depositMode: terms.depositMode,
    swapType: "EXACT_INPUT",
    slippageTolerance: Math.min(terms.slippageTolerance, MAX_TRANSFER_SLIPPAGE_BPS),
    originAsset: transfer.sourceAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: transfer.destinationAsset,
    amount: amountBase,
    refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
    referral: REFERRAL,
  };
  try {
    return await requestQuote(request);
  } catch (error) {
    if (!(error instanceof OneClickError) || error.status !== 400 || request.slippageTolerance >= MAX_TRANSFER_SLIPPAGE_BPS) throw error;
    return requestQuote({ ...request, slippageTolerance: MAX_TRANSFER_SLIPPAGE_BPS });
  }
}

/** 1Click statuses of a swap deposit address after which sending again cannot pay twice: nothing arrived, or it went back to the wallet. */
const RESENDABLE_STATUSES: ReadonlySet<StatusResponse["status"]> = new Set(["PENDING_DEPOSIT", "REFUNDED", "FAILED"]);

/** Refuses to replace a swap's deposit address that already received the merchant's coins, which 1Click still delivers. */
async function assertNotDeposited(transfer: Transfer): Promise<void> {
  const { status } = await fetchStatus(transfer.depositAddress!, transfer.depositMemo);
  if (!RESENDABLE_STATUSES.has(status)) {
    throw new ApiError(409, "invalid_state", "Your wallet already sent this transfer to the payment network. Paste its transaction hash to record it instead of sending it again.");
  }
}

/** What the merchant's wallet must send: same coin goes direct to the recipient, otherwise to a 1Click swap's deposit address.
    A prepared transfer may already be sent: it is prepared again only with `sendAgain`, a swap only if 1Click shows its old address got nothing. */
export async function prepareTransfer(transferId: string, merchantId: string, sendAgain: boolean): Promise<PreparedTransfer> {
  const transfer = await load(transferId, merchantId);
  if (transfer.status !== "pending") throw new ApiError(409, "invalid_state", "This transfer was already sent.");
  if (transfer.depositAddress && !sendAgain) return { preparedBefore: true };
  if (transfer.depositAddress && transfer.correlationId) await assertNotDeposited(transfer);
  const { merchant } = transfer;
  if (!merchant.payoutAddress || !merchant.payoutVerifiedAt) throw new ApiError(409, "invalid_state", "A payout wallet must be verified first, which the owner does in Settings.");

  const source = await findToken(transfer.sourceAsset);
  const chain = source && chainForToken(source);
  if (!source || !chain) throw new ApiError(409, "invalid_state", "The coin you receive is no longer supported. Choose another one in Settings.");
  if (chain.id !== merchant.payoutChain) throw new ApiError(409, "invalid_state", "This transfer was created for your earlier payout network. Cancel it and create a new one.");
  const amountBase = toBaseUnits(transfer.amount, source.decimals).toString();
  if (amountBase === "0") throw new ApiError(409, "invalid_state", SPLIT_ON_HOLD);
  const base = { evmChainId: chain.evmChainId, tokenContract: source.contractAddress ?? null, decimals: source.decimals, amountBase };
  /** An Earn withdrawal goes to the payout wallet as it is when sending, never to one replaced since the withdrawal was created. */
  const recipient = transfer.kind === "withdrawal" ? merchant.payoutAddress : transfer.recipient;

  /** Only the first preparation is kept, so the wallet never sends to a replaced address; a split payout that a refund
      resized or canceled meanwhile is not sent (409, reload). */
  const unchanged = { id: transfer.id, status: "pending", depositAddress: transfer.depositAddress, amount: transfer.amount } as const;
  const lostRace = async (): Promise<PreparedTransfer> => {
    const current = await getDb().transfer.findUniqueOrThrow({ where: { id: transfer.id }, select: { depositAddress: true } });
    if (current.depositAddress !== transfer.depositAddress) return { preparedBefore: true };
    throw new ApiError(409, "invalid_state", "This transfer changed meanwhile. Reload the page.");
  };
  /** Stored under the business row's shared lock, so a payout wallet change lands wholly before (this refuses, reload) or after
      (the change refuses while this transfer is being sent), never between reading the wallet and binding the transfer to it. */
  const storePreparation = (data: Prisma.TransferUpdateManyMutationInput) =>
    getDb().$transaction(async (tx) => {
      await lockMerchantShared(tx, merchant.id);
      const current = await tx.merchant.findUniqueOrThrow({ where: { id: merchant.id }, select: { payoutAddress: true, payoutChain: true } });
      if (current.payoutAddress !== merchant.payoutAddress || current.payoutChain !== merchant.payoutChain) {
        throw new ApiError(409, "invalid_state", "Your payout wallet changed meanwhile. Reload the page.");
      }
      return (await tx.transfer.updateMany({ where: unchanged, data })).count;
    });
  if (transfer.sourceAsset === transfer.destinationAsset) {
    if (!source.contractAddress && chain.family === "evm" && (await isContractWallet(chain, merchant.payoutAddress))) {
      throw new ApiError(
        409,
        "invalid_state",
        `Your payout wallet is a smart-contract wallet, and Solverr cannot confirm ${source.symbol} sent from it. Send it from your wallet yourself, then cancel this transfer.`,
      );
    }
    /** The sender is fixed here, so the on-chain check looks for the wallet that was asked to send. */
    const count = await storePreparation({ recipient, depositAddress: recipient, amountInBase: amountBase, txSender: merchant.payoutAddress });
    if (count === 0) return lostRace();
    return { instruction: { ...base, depositAddress: recipient } };
  }

  let response;
  try {
    response = await quoteTransfer(transfer, source, amountBase, recipient, merchant.payoutAddress);
  } catch (error) {
    if (isRefusal(error)) {
      throw new ApiError(422, "quote_unavailable", `The payment network cannot route this transfer: ${oneClickMessage(error)}`);
    }
    throw error;
  }
  const depositAddress = response.quote.depositAddress;
  if (!depositAddress) throw new OneClickError("1Click quote response has no deposit address");
  /** The worker follows the new deposit address from now on, so a swap the wallet sends but nobody records still completes. */
  const count = await storePreparation({
    recipient,
    depositAddress,
    depositMemo: response.quote.depositMemo ?? null,
    amountInBase: response.quote.amountIn,
    correlationId: response.correlationId,
    rawQuote: response,
    txSender: merchant.payoutAddress,
    oneclickStatus: null,
    nextPollAt: new Date(Date.now() + POLL_MS),
  });
  if (count === 0) return lostRace();
  return { instruction: { ...base, amountBase: response.quote.amountIn, depositAddress } };
}

/** Records the merchant's transaction for the worker to confirm (on-chain for direct, via 1Click for swaps). `paidTo`, when the
    wallet reported where it sent, must still be the transfer's address. A processing direct transfer accepts a replacing hash. */
export async function reportTransferTx(transferId: string, merchantId: string, reportedHash: string, paidTo?: string): Promise<void> {
  const transfer = await load(transferId, merchantId);
  if (paidTo !== undefined && paidTo !== transfer.depositAddress) {
    throw new ApiError(409, "invalid_state", "Your wallet sent this to an earlier payment address of this transfer. Check the transfer before you send it again.");
  }
  const source = await findToken(transfer.sourceAsset);
  const chain = source && chainForToken(source);
  if (chain && !isTransactionHash(chain, reportedHash)) throw new ApiError(400, "invalid_request", `This is not a transaction hash on ${chain.name}. Copy it from your wallet's activity.`);
  /** EVM hashes are hex in any case; one spelling keeps a transaction from being recorded twice. */
  const txHash = chain?.family === "evm" ? reportedHash.toLowerCase() : reportedHash;
  /** A repeated report (a retried request, or a swap the worker already followed) changes nothing. */
  if (transfer.status === "processing" && transfer.txHash === txHash) return;
  /** A swap the worker already saw reach 1Click is on its way; the report only fills in a hash 1Click did not give. */
  if (transfer.status === "processing" && transfer.correlationId) {
    if (transfer.txHash) return;
    const db = getDb();
    await releaseEndedTxHash(db, txHash);
    await db.transfer.updateMany({ where: { id: transfer.id, status: "processing", txHash: null }, data: { txHash, txReportedAt: new Date() } }).catch((error: unknown) => {
      /** The hash is held by another open transfer; this one completes from 1Click's own record either way. */
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    });
    return;
  }
  const replacing = transfer.status === "processing" && !transfer.correlationId;
  if (!replacing && (transfer.status !== "pending" || !transfer.depositAddress)) throw new ApiError(409, "invalid_state", "Prepare the transfer before reporting its transaction.");
  let count: number;
  try {
    const db = getDb();
    await releaseEndedTxHash(db, txHash);
    ({ count } = await db.transfer.updateMany({
      where: { id: transfer.id, status: transfer.status, depositAddress: transfer.depositAddress, txHash: transfer.txHash },
      data: { status: "processing", txHash, txReportedAt: new Date(), txSender: transfer.txSender ?? transfer.merchant.payoutAddress, nextPollAt: new Date() },
    }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError(409, "invalid_state", "This transaction was already recorded for another transfer. Record the transaction that sent this one.");
    }
    throw error;
  }
  if (count === 0) throw new ApiError(409, "invalid_state", "This transfer was already reported or prepared again. Reload the page.");
  if (!transfer.correlationId || !transfer.depositAddress) return;
  await submitDeposit(txHash, transfer.depositAddress, transfer.depositMemo).catch((error: Error) =>
    log.error({ transfer: transfer.id, error: errorMessage(error) }, "Deposit report failed"),
  );
}

/** Completes a direct transfer once its transaction is final with the right amount; fails it if wrong or unfound within DIRECT_TX_WATCH_MS. */
async function pollDirectTransfer(transfer: Transfer & { merchant: Merchant }): Promise<void> {
  const db = getDb();
  const source = await findToken(transfer.sourceAsset);
  const chain = source && chainForToken(source);
  if (!source || !chain || !transfer.txHash || !transfer.txSender || !transfer.amountInBase || !transfer.depositAddress) {
    await endTransfer(transfer, "failed", "The transfer is missing what is needed to find its transaction.");
    return;
  }
  const check = await checkDirectTransfer({
    chain,
    tokenContract: source.contractAddress ?? null,
    from: transfer.txSender,
    to: transfer.depositAddress,
    amountBase: BigInt(transfer.amountInBase),
    txHash: transfer.txHash,
    notBefore: transfer.createdAt,
  });
  if (check.state === "confirmed") {
    await db.$transaction((tx) => complete(tx, transfer, transfer.merchant, transfer.txHash));
  } else if (check.state === "failed") {
    await endTransfer(transfer, "failed", check.reason);
  } else if (directWatchOver(transfer)) {
    await endTransfer(transfer, "failed", "The network never confirmed the transaction your wallet reported.");
  } else {
    await db.transfer.update({ where: { id: transfer.id }, data: { nextPollAt: new Date(Date.now() + POLL_MS) } });
  }
}

/** Fails or cancels a transfer with its credits, alert and webhook in one transaction; returns false, ending nothing,
    if its status, deposit address or txHash changed since read (prepared, sent or re-reported meanwhile). */
async function endTransfer(transfer: Transfer, status: "failed" | "canceled", reason: string, oneclickStatus: StatusResponse["status"] | null = null): Promise<boolean> {
  return getDb().$transaction(async (tx) => {
    /** A refund locks its invoice first, as `createRefund` does, so the two take turns instead of deadlocking. */
    const refundInvoiceId = transfer.kind === "refund" ? transfer.invoiceId : null;
    if (refundInvoiceId) await lockInvoice(tx, refundInvoiceId);
    const { count } = await tx.transfer.updateMany({
      where: { id: transfer.id, status: transfer.status, depositAddress: transfer.depositAddress, txHash: transfer.txHash },
      data: { status, oneclickStatus, failureReason: reason, nextPollAt: null },
    });
    if (count === 0) return false;
    if (transfer.kind === "refund") await restoreTopUpCredits(tx, transfer.id);
    /** The refunded amount is kept again, so the invoice's unsent split payouts grow back to their share of it. */
    if (refundInvoiceId) await resizeSplitPayouts(tx, refundInvoiceId);
    if (status === "failed") await createAlert(transfer.merchantId, "transfer_failed", `${KIND_LABELS[transfer.kind]} ${transfer.id} did not complete: ${reason}`, tx);
    /** Earn withdrawals move the merchant's own funds and have no webhook event. */
    if (transfer.kind !== "withdrawal") {
      const [ended, merchant] = await Promise.all([tx.transfer.findUniqueOrThrow({ where: { id: transfer.id } }), tx.merchant.findUniqueOrThrow({ where: { id: transfer.merchantId } })]);
      await enqueueWebhook(tx, merchant, "live", `${transfer.kind}.${status}`, { [transfer.kind]: serializeTransfer(ended) });
    }
    return true;
  });
}

/** Cancels an unsent transfer. `confirmed` (dashboard: nothing left the wallet) counts only for the deposit address its page showed;
    a prepared direct transfer needs it, and so does a prepared swap until its deposit window closes (the API answers 409). */
export async function cancelTransfer(transferId: string, merchantId: string, confirmed?: { depositAddress: string | null }): Promise<Transfer> {
  const transfer = await load(transferId, merchantId);
  if (transfer.status === "processing") throw new ApiError(409, "invalid_state", "This transfer was already sent, so it can no longer be canceled.");
  if (transfer.status !== "pending") throw new ApiError(409, "invalid_state", "This transfer has already ended.");
  /** Canceling would drop the share for good, though a failed refund would have paid it again. */
  if (splitOnHold(transfer)) throw new ApiError(409, "invalid_state", SPLIT_ON_HOLD);
  if (confirmed && confirmed.depositAddress !== transfer.depositAddress) {
    throw new ApiError(409, "invalid_state", "This transfer was prepared from another page meanwhile, so your wallet may be sending it. Reload the page.");
  }
  if (transfer.depositAddress && !transfer.correlationId && !confirmed) {
    throw new ApiError(409, "invalid_state", "This transfer was prepared in the dashboard and may already have been sent from your wallet. Cancel it in the dashboard, which asks you to confirm first.");
  }
  if (transfer.depositAddress && transfer.correlationId) {
    await assertNotDeposited(transfer);
    const windowEnd = depositWindowEnd(transfer);
    if (!confirmed && windowEnd && windowEnd.getTime() >= Date.now()) {
      throw new ApiError(
        409,
        "invalid_state",
        `This transfer's NEAR Intents deposit address accepts your wallet's transaction until ${formatUtcDateTime(windowEnd)}. Cancel it after that, or cancel it in the dashboard if your wallet did not send it.`,
      );
    }
  }
  if (!(await endTransfer(transfer, "canceled", "Canceled by the business."))) throw new ApiError(409, "invalid_state", "This transfer changed meanwhile. Reload the page.");
  return getDb().transfer.findUniqueOrThrow({ where: { id: transfer.id } });
}

/** Claims up to POLL_BATCH due transfers by moving next_poll_at CLAIM_LEASE_MS ahead; SKIP LOCKED keeps a second worker off them.
    A pending transfer is due only while its prepared swap's deposit address is watched. */
async function claimDueTransfers(): Promise<string[]> {
  const now = new Date();
  const rows = await getDb().$queryRaw<{ id: string }[]>`
    UPDATE transfers SET next_poll_at = ${new Date(now.getTime() + CLAIM_LEASE_MS)}
    WHERE id IN (
      SELECT id FROM transfers
      WHERE status IN ('processing', 'pending') AND next_poll_at <= ${now}
      ORDER BY next_poll_at
      LIMIT ${POLL_BATCH}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  return rows.map((row) => row.id);
}

/** Follows a prepared swap nobody recorded until 1Click sees its deposit; if the window closes empty or the coins are
    refunded, watching stops and the transfer stays pending, to be sent again or canceled. */
async function followPreparedSwap(transfer: Transfer & { merchant: Merchant }, status: StatusResponse): Promise<void> {
  const db = getDb();
  const originTx = status.swapDetails?.originChainTxHashes?.[0]?.hash ?? null;
  const unchanged = { id: transfer.id, status: "pending", depositAddress: transfer.depositAddress } as const;
  if (status.status === "SUCCESS") {
    await db.$transaction((tx) => complete(tx, transfer, transfer.merchant, originTx));
  } else if (status.status === "PENDING_DEPOSIT" && !depositWindowClosed(transfer)) {
    await db.transfer.updateMany({ where: unchanged, data: { oneclickStatus: status.status, nextPollAt: new Date(Date.now() + POLL_MS) } });
  } else if (status.status === "PENDING_DEPOSIT" || status.status === "REFUNDED" || status.status === "FAILED") {
    await db.transfer.updateMany({ where: unchanged, data: { oneclickStatus: status.status, nextPollAt: null } });
  } else {
    if (originTx) await releaseEndedTxHash(db, originTx);
    await db.transfer.updateMany({
      where: unchanged,
      data: { status: "processing", txHash: originTx, txReportedAt: new Date(), oneclickStatus: status.status, nextPollAt: new Date(Date.now() + POLL_MS) },
    });
  }
}

/** Worker job: follows sent transfers, a swap by its 1Click status and a direct transfer by its transaction on-chain. */
export async function pollTransfers(signal: AbortSignal): Promise<number> {
  const db = getDb();
  const started = Date.now();
  const due = await db.transfer.findMany({ where: { id: { in: await claimDueTransfers() } }, include: { merchant: true } });
  /** One outage fails every transfer alike, so the run reports its first failure once, with a count; each transfer is still logged. */
  let failures = 0;
  let firstFailure: unknown;
  for (const [index, transfer] of due.entries()) {
    /** Transfers not reached before shutdown or the batch budget are handed back, so no claim outlives its lease. */
    if (signal.aborted || Date.now() - started > BATCH_BUDGET_MS) {
      await db.transfer.updateMany({ where: { id: { in: due.slice(index).map((left) => left.id) } }, data: { nextPollAt: new Date() } });
      break;
    }
    try {
      if (!transfer.correlationId) {
        await pollDirectTransfer(transfer);
        continue;
      }
      const status = await fetchStatus(transfer.depositAddress!, transfer.depositMemo);
      if (transfer.status === "pending") {
        await followPreparedSwap(transfer, status);
        continue;
      }
      if (status.status === "SUCCESS") {
        await db.$transaction((tx) => complete(tx, transfer, transfer.merchant, transfer.txHash));
      } else if (status.status === "REFUNDED" || status.status === "FAILED") {
        const reason = status.status === "REFUNDED" ? `Refunded to your wallet (${status.swapDetails.refundReason ?? "swap not completed"}).` : "The swap failed.";
        await endTransfer(transfer, "failed", reason, status.status);
      } else if (status.status === "PENDING_DEPOSIT" && depositWindowClosed(transfer)) {
        await endTransfer(transfer, "failed", "The payment network never received the transaction from your wallet.", status.status);
      } else {
        await db.transfer.update({ where: { id: transfer.id }, data: { oneclickStatus: status.status, nextPollAt: new Date(Date.now() + POLL_MS) } });
      }
    } catch (error) {
      log.error({ transfer: transfer.id, error: errorMessage(error) }, "Status check failed");
      if (failures++ === 0) firstFailure = error;
      /** A swap keeps waiting for 1Click, which decides its outcome; a direct transaction that cannot be checked for a day fails. */
      if (!transfer.correlationId && directWatchOver(transfer)) {
        await endTransfer(transfer, "failed", "The network could not confirm the transaction your wallet reported.");
      } else {
        await db.transfer.update({ where: { id: transfer.id }, data: { nextPollAt: new Date(Date.now() + POLL_MS * 2) } });
      }
    }
  }
  if (failures > 0) reportError(firstFailure, { job: "transfers", failures: String(failures), of: String(due.length) });
  return due.length;
}
