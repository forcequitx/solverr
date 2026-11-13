import { z } from "zod";
import type { Invoice, InvoiceStatus, Merchant, Prisma, Quote } from "@/generated/prisma/client";
import { ApiError } from "@/lib/api/errors";
import { rateLimit } from "@/lib/api/rate-limit";
import { isValidAddress } from "@/lib/chains/addresses";
import { chainForToken, getChain } from "@/lib/chains/registry";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/ids";
import { errorMessage, logger } from "@/lib/logger";
import { alertOwner } from "@/lib/merchants/alerts";
import { formatMinimumUsd } from "@/lib/money";
import { isRefusal, OneClickError, oneClickMessage } from "@/lib/oneclick/client";
import { isConfidentialQuote, isConfidentialRefusal, privateLevel, privatePaymentsUnavailable } from "@/lib/oneclick/confidentiality";
import { REFERRAL } from "@/lib/oneclick/constants";
import { paymentNetwork } from "@/lib/oneclick/network";
import { routeMinimumUsd } from "@/lib/oneclick/route-minimum";
import { findToken, isUsdStablecoin } from "@/lib/oneclick/tokens";
import type { OneClickToken, QuoteRequest, QuoteResponse } from "@/lib/oneclick/types";
import { notifyCheckout, notifyCheckouts } from "@/lib/payments/checkout-events";
import { lockInvoice, lockMerchantShared } from "@/lib/row-locks";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "@/lib/time";

const log = logger.child({ module: "quote" });

export const QUOTE_TTL_MS = 20 * MINUTE_MS;
/** A new deposit address needs at least this much invoice lifetime left. */
export const MIN_QUOTE_MS = 2 * MINUTE_MS;
export const RETIRED_WATCH_MS = DAY_MS;
/** New deposit addresses per invoice in QUOTE_WINDOW_MS; a rolling window, so used-up attempts never lock the invoice for good. */
const MAX_QUOTES_PER_INVOICE = 10;
const QUOTE_WINDOW_MS = HOUR_MS;
/** New deposit addresses per merchant per minute across its checkouts: at most 40% of an instance's 300 1Click calls a minute. */
const MERCHANT_QUOTES_PER_MINUTE = 120;
const PAYMENT_ALREADY_SENT = "A payment was already sent for this invoice. Wait for it to arrive and do not send it again.";
const SLIPPAGE_BPS = { stable: 10, other: 100 } as const;
/** Invoice states in which the customer may (re)start paying. */
export const QUOTABLE: ReadonlySet<InvoiceStatus> = new Set<InvoiceStatus>(["created", "awaiting_payment", "refunded", "failed"]);
const TEST_RECIPIENT = "test-recipient";
/** NEAR Intents account named as the refund target of dry checks; a dry quote has no deposit address, so nothing can be refunded. */
export const DRY_CHECK_REFUND_ACCOUNT = "intents.near";
/** Owner alert kind (dashboard and email) for a private payment NEAR Intents refused, and the least time between two such alerts. */
const PRIVATE_ALERT_KIND = "private_payments_refused";
const PRIVATE_ALERT_GAP_MS = HOUR_MS;

export const createQuoteSchema = z.strictObject({
  origin_asset: z.string({ error: "origin_asset is required." }).min(1).max(200),
  refund_address: z.string({ error: "refund_address is required." }).trim().min(1).max(200),
});

type CreateQuoteInput = z.infer<typeof createQuoteSchema>;

type InvoiceWithMerchant = Invoice & { merchant: Merchant };

/** Resolves the payer's coin and checks the refund address for its chain; `null` skips the check for a dry check. */
export async function resolveOrigin(originAsset: string, refundAddress: string | null): Promise<OneClickToken> {
  const token = await findToken(originAsset);
  const chain = token && chainForToken(token);
  if (!token || !chain) throw new ApiError(400, "invalid_request", "This coin is not supported for payments.", "origin_asset");
  if (refundAddress !== null && !isValidAddress(chain.family, refundAddress)) {
    throw new ApiError(400, "invalid_request", `This is not a valid ${chain.name} address.`, "refund_address");
  }
  return token;
}

function recipientFor(invoice: InvoiceWithMerchant): string {
  const { merchant } = invoice;
  if (merchant.payoutAddress && merchant.payoutVerifiedAt) {
    /** The settlement coin was fixed when the invoice was created; it must still live on the merchant's payout network. */
    if (merchant.payoutChain !== invoice.destinationChain) {
      throw closedInvoice("payout_changed", "This payment was created for a payout network the business no longer uses. Ask the business for a new link.");
    }
    return merchant.payoutAddress;
  }
  if (invoice.mode === "test") return TEST_RECIPIENT;
  throw new ApiError(409, "invalid_state", "This business has not finished setting up its payout wallet yet.");
}

/** How a payment from `origin` is deposited and how much price movement it tolerates: tight between two dollar stablecoins. */
export function routeTerms(origin: OneClickToken, destination: OneClickToken | undefined): Pick<QuoteRequest, "depositMode" | "slippageTolerance"> {
  const bothStable = !!destination && isUsdStablecoin(origin) && isUsdStablecoin(destination);
  return {
    depositMode: getChain(origin.blockchain)?.depositMemo ? "MEMO" : "SIMPLE",
    slippageTolerance: bothStable ? SLIPPAGE_BPS.stable : SLIPPAGE_BPS.other,
  };
}

/** The refusal a customer gets when a private payment cannot be quoted; it names no coin because every coin is affected. */
export function privatePaymentRefused(): ApiError {
  return new ApiError(422, "quote_unavailable", "Private payments are not available right now. Try again later, or contact the business.");
}

/** The confidentiality of a private merchant's quote; without a level this server can serve, the payment is refused, never quoted as a public intent. */
function confidentialityFor(invoice: InvoiceWithMerchant): Pick<QuoteRequest, "confidentiality"> {
  if (!invoice.merchant.privatePayments) return {};
  const level = privateLevel(invoice.mode);
  if (!level) throw privatePaymentRefused();
  return { confidentiality: level };
}

/** Tells the owner, at most once per PRIVATE_ALERT_GAP_MS, that a customer could not start a private payment; returns the customer's error. */
async function refusePrivatePayment(invoice: InvoiceWithMerchant, reason: string): Promise<ApiError> {
  log.error({ invoice: invoice.id, reason: errorMessage(reason) }, "Private payment refused");
  const since = new Date(Date.now() - PRIVATE_ALERT_GAP_MS);
  const recent = await getDb().alert.findFirst({ where: { merchantId: invoice.merchantId, kind: PRIVATE_ALERT_KIND, createdAt: { gte: since } }, select: { id: true } });
  if (!recent) {
    const message = `A customer could not start a private payment for invoice ${invoice.id}: ${reason.replace(/\.$/, "")}. Customers cannot pay until private payments work again, or until you turn them off in Settings.`;
    await alertOwner(invoice.merchant, PRIVATE_ALERT_KIND, message, "/dashboard/settings");
  }
  return privatePaymentRefused();
}

/** Builds the EXACT_OUTPUT 1Click request paying the invoice amount to the merchant, refunds to `refundTo` (`null` only for a dry check). */
export async function buildQuoteRequest(invoice: InvoiceWithMerchant, origin: OneClickToken, refundTo: string | null, dry: boolean, deadline: Date): Promise<QuoteRequest> {
  if (refundTo === null && !dry) throw new Error("A quote that can receive funds needs a refund address.");
  return {
    dry,
    ...routeTerms(origin, await findToken(invoice.destinationAsset)),
    swapType: "EXACT_OUTPUT",
    originAsset: origin.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: invoice.destinationAsset,
    amount: invoice.amountOutBase,
    ...(refundTo === null ? { refundTo: DRY_CHECK_REFUND_ACCOUNT, refundType: "INTENTS" as const } : { refundTo, refundType: "ORIGIN_CHAIN" as const }),
    recipient: recipientFor(invoice),
    recipientType: "DESTINATION_CHAIN",
    deadline: deadline.toISOString(),
    referral: REFERRAL,
    ...confidentialityFor(invoice),
  };
}

/** The smallest payment in USD 1Click names for paying this invoice's coin with `origin`, or null. */
export async function refusalMinimum(error: OneClickError, origin: OneClickToken, invoice: Pick<Invoice, "destinationAsset">): Promise<number | null> {
  return routeMinimumUsd(error, origin, await findToken(invoice.destinationAsset));
}

/** A refused real quote says only "Failed to get quote", so a dry quote of the same request is asked for the reason (e.g. a minimum).
    Returns the dry quote's refusal, or `original` when the dry quote is not refused. */
async function dryRefusal(network: ReturnType<typeof paymentNetwork>, request: QuoteRequest, original: OneClickError): Promise<OneClickError> {
  try {
    await network.estimate({ ...request, dry: true });
  } catch (error) {
    if (isRefusal(error)) return error;
  }
  return original;
}

/** Turns a 1Click quote rejection into a customer message; with a named minimum it also suggests the settlement coin, unless that is the refused coin. */
export async function quoteRejection(
  error: OneClickError,
  origin: OneClickToken,
  invoice: Pick<Invoice, "destinationAsset" | "destinationSymbol" | "destinationChain">,
): Promise<ApiError> {
  const chainName = getChain(origin.blockchain)?.name ?? origin.blockchain;
  const minimum = await refusalMinimum(error, origin, invoice);
  if (minimum) {
    const settlementChain = getChain(invoice.destinationChain)?.name ?? invoice.destinationChain;
    const advice = origin.assetId === invoice.destinationAsset ? "Choose another coin." : `Pay with ${invoice.destinationSymbol} on ${settlementChain}, or choose another coin.`;
    return new ApiError(422, "quote_unavailable", `${origin.symbol} on ${chainName} needs a payment of at least ${formatMinimumUsd(minimum)} right now. ${advice}`, "origin_asset");
  }
  return new ApiError(422, "quote_unavailable", `${origin.symbol} on ${chainName} cannot be used for this payment right now. Choose another coin.`, "origin_asset");
}

/** A 409 for an invoice that cannot take a new payment, with a code naming why. */
export const closedInvoice = (code: "invoice_paid" | "invoice_expired" | "payment_in_progress" | "payout_changed", message: string) =>
  new ApiError(409, "invalid_state", message, undefined, undefined, code);

/** Refuses a new deposit address while the invoice cannot take a payment. */
export function assertQuotable(invoice: Pick<Invoice, "status" | "expiresAt">): void {
  if (invoice.status === "paid") throw closedInvoice("invoice_paid", "This invoice is already paid.");
  if (!QUOTABLE.has(invoice.status)) {
    throw invoice.status === "expired"
      ? closedInvoice("invoice_expired", "This invoice has expired.")
      : closedInvoice("payment_in_progress", "A payment for this invoice is already in progress. Wait for it to arrive and do not send it again.");
  }
  if (invoice.expiresAt.getTime() - Date.now() < MIN_QUOTE_MS) throw closedInvoice("invoice_expired", "This invoice has expired.");
}

/** How long past its address's deadline an unseen reported transaction still blocks new addresses and gets close polling.
    1Click accepts any well-formed hash, so do not extend it: made-up reports could starve real payment polling. */
export const REPORTED_GRACE_MS = HOUR_MS;

/** Whether the quote holds a reported transaction that 1Click has not seen yet and that still counts as a payment on its way. */
export const reportedInFlight = (quote: Pick<Quote, "depositTxHash" | "walletSentAt" | "oneclickStatus" | "deadline">) =>
  (quote.depositTxHash !== null || quote.walletSentAt !== null) && quote.oneclickStatus === "PENDING_DEPOSIT" && quote.deadline.getTime() + REPORTED_GRACE_MS > Date.now();

/** Quotes of the invoice that `reportedInFlight` matches, as a query; a retired address counts too, since 1Click still delivers to it. */
const reportedInFlightWhere = (invoiceId: string): Prisma.QuoteWhereInput => ({
  invoiceId,
  state: { in: ["active", "retired"] },
  oneclickStatus: "PENDING_DEPOSIT",
  OR: [{ depositTxHash: { not: null } }, { walletSentAt: { not: null } }],
  deadline: { gt: new Date(Date.now() - REPORTED_GRACE_MS) },
});

/** What retiring an open deposit address writes: it stays watched for 24 hours in case a payment still arrives. */
const retired = () => ({ state: "retired" as const, watchUntil: new Date(Date.now() + RETIRED_WATCH_MS), nextPollAt: new Date() });

/** Retires the invoice's open deposit addresses; they stay watched for 24 hours in case a payment still arrives. */
export async function retireOpenQuotes(tx: Prisma.TransactionClient, invoiceId: string, keepQuoteId?: string): Promise<void> {
  await tx.quote.updateMany({
    where: { invoiceId, state: "active", oneclickStatus: "PENDING_DEPOSIT", ...(keepQuoteId ? { id: { not: keepQuoteId } } : {}) },
    data: retired(),
  });
}

/** Retires (still watched) every open deposit address of the business and refreshes its checkouts, so a payout wallet or privacy
    change leaves no checkout showing an address that pays the old way. Three statements for any number of checkouts, so the
    transaction stays short even with every query crossing the internet from Vercel. */
export async function retireMerchantOpenQuotes(tx: Prisma.TransactionClient, merchantId: string): Promise<void> {
  /** Invoices are locked in id order, so two of these at once cannot deadlock. */
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT i.id FROM invoices i
    WHERE i.merchant_id = ${merchantId}
      AND EXISTS (SELECT 1 FROM quotes q WHERE q.invoice_id = i.id AND q.state = 'active' AND q.oneclick_status = 'PENDING_DEPOSIT')
    ORDER BY i.id
    FOR UPDATE OF i`;
  if (locked.length === 0) return;
  const invoiceIds = locked.map((row) => row.id);
  await tx.quote.updateMany({ where: { invoiceId: { in: invoiceIds }, state: "active", oneclickStatus: "PENDING_DEPOSIT" }, data: retired() });
  await notifyCheckouts(tx, invoiceIds);
}

/** Whether an open address answers this request: same coin, refund address, privacy and recipient, with time left to pay. The recipient
    is compared too, so an address quoted before the merchant replaced their payout wallet is never handed out again. */
function answersRequest(open: Quote, invoice: InvoiceWithMerchant, origin: OneClickToken, refundAddress: string | null): boolean {
  return (
    open.deadline.getTime() - Date.now() > MIN_QUOTE_MS &&
    open.originAsset === origin.assetId &&
    open.refundTo === refundAddress &&
    isConfidentialQuote(open.rawResponse) === invoice.merchant.privatePayments &&
    (open.rawResponse as QuoteResponse | null)?.quoteRequest?.recipient === recipientFor(invoice)
  );
}

/** Issues a deposit address, retiring earlier active ones (watched 24 h); an open one with the same coin, refund address,
    privacy and recipient is returned instead. Also returns the settlement chain the payment's public shape names. */
export async function createQuote(invoiceId: string, input: CreateQuoteInput): Promise<{ quote: Quote; destinationChain: string }> {
  const db = getDb();
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId }, include: { merchant: true } });
  if (!invoice) throw new ApiError(404, "not_found", "No invoice with this id.", "id");
  assertQuotable(invoice);
  /** A reported payment is still on its way, even to an address that ran out of time, so a second address would invite paying twice. */
  if (await db.quote.count({ where: reportedInFlightWhere(invoiceId) })) throw closedInvoice("payment_in_progress", PAYMENT_ALREADY_SENT);

  const origin = await resolveOrigin(input.origin_asset, input.refund_address);
  const open = await db.quote.findFirst({ where: { invoiceId, state: "active", oneclickStatus: "PENDING_DEPOSIT" }, orderBy: { createdAt: "desc" } });
  if (open && answersRequest(open, invoice, origin, input.refund_address)) return { quote: open, destinationChain: invoice.destinationChain };
  const recent = await db.quote.findMany({
    where: { invoiceId, createdAt: { gte: new Date(Date.now() - QUOTE_WINDOW_MS) } },
    orderBy: { createdAt: "desc" },
    take: MAX_QUOTES_PER_INVOICE,
    select: { createdAt: true },
  });
  if (recent.length >= MAX_QUOTES_PER_INVOICE) {
    const retryAfter = Math.max(1, Math.ceil((recent[recent.length - 1].createdAt.getTime() + QUOTE_WINDOW_MS - Date.now()) / 1000));
    const minutes = Math.ceil(retryAfter / 60);
    throw new ApiError(429, "rate_limited", `Too many payment attempts for this invoice. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`, undefined, retryAfter, "too_many_attempts");
  }

  const unavailable = invoice.merchant.privatePayments && invoice.mode === "live" ? privatePaymentsUnavailable() : null;
  if (unavailable) throw await refusePrivatePayment(invoice, unavailable);
  /** Anyone with a public link can ask for addresses, so one merchant's checkouts cannot use up the shared 1Click capacity. */
  await rateLimit(`quote-merchant:${invoice.merchantId}`, MERCHANT_QUOTES_PER_MINUTE, 60_000);

  const deadline = new Date(Math.min(Date.now() + QUOTE_TTL_MS, invoice.expiresAt.getTime()));
  const request = await buildQuoteRequest(invoice, origin, input.refund_address, false, deadline);

  const network = paymentNetwork(invoice.mode);
  let response;
  try {
    response = await network.quote(request);
  } catch (error) {
    if (isRefusal(error)) {
      if (request.confidentiality && isConfidentialRefusal(error)) throw await refusePrivatePayment(invoice, oneClickMessage(error));
      const named = (await refusalMinimum(error, origin, invoice)) !== null;
      throw await quoteRejection(named ? error : await dryRefusal(network, request, error), origin, invoice);
    }
    throw error;
  }
  /** A private payment's address is used only when the request 1Click signed echoes a confidential level; a missing echo refuses it. */
  if (request.confidentiality && !isConfidentialQuote(response)) {
    throw await refusePrivatePayment(invoice, "NEAR Intents did not confirm the quote as confidential");
  }
  const quote = response.quote;
  if (!quote.depositAddress) throw new OneClickError("1Click quote response has no deposit address");

  const created = await db.$transaction(async (tx) => {
    /** The merchant lock first (lock order), so a payout wallet or privacy change still being saved is seen below, not missed.
        A payment may have been detected during the 1Click call; re-check under the invoice lock before replacing the address. */
    await lockMerchantShared(tx, invoice.merchantId);
    await lockInvoice(tx, invoiceId);
    assertQuotable(await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true, expiresAt: true } }));
    if (await tx.quote.count({ where: reportedInFlightWhere(invoiceId) })) throw closedInvoice("payment_in_progress", PAYMENT_ALREADY_SENT);
    /** The business may have changed its payout wallet, network or privacy during the 1Click call; that change retires open addresses, so this one must match it. */
    const current = await tx.merchant.findUniqueOrThrow({
      where: { id: invoice.merchantId },
      select: { payoutAddress: true, payoutChain: true, payoutVerifiedAt: true, privatePayments: true },
    });
    if (
      current.payoutAddress !== invoice.merchant.payoutAddress ||
      current.payoutChain !== invoice.merchant.payoutChain ||
      !current.payoutVerifiedAt !== !invoice.merchant.payoutVerifiedAt ||
      current.privatePayments !== invoice.merchant.privatePayments
    ) {
      throw new ApiError(409, "invalid_state", "The business just changed how it receives payments. Choose your coin again.");
    }
    /** An identical request may have stored its address during this one's 1Click call; that address stays and this one is dropped. */
    const stored = await tx.quote.findFirst({ where: { invoiceId, state: "active", oneclickStatus: "PENDING_DEPOSIT" }, orderBy: { createdAt: "desc" } });
    if (stored && answersRequest(stored, invoice, origin, input.refund_address)) return stored;
    await retireOpenQuotes(tx, invoiceId);
    const row = await tx.quote.create({
      data: {
        id: newId("quo"),
        invoiceId,
        originAsset: origin.assetId,
        originSymbol: origin.symbol,
        originChain: origin.blockchain,
        originDecimals: origin.decimals,
        depositAddress: quote.depositAddress!,
        depositMemo: quote.depositMemo ?? null,
        amountIn: quote.amountIn,
        amountInFormatted: quote.amountInFormatted,
        minAmountIn: quote.minAmountIn,
        amountInUsd: quote.amountInUsd ?? null,
        refundTo: input.refund_address,
        /** The requested deadline, when 1Click starts refunding; its `quote.deadline` is days later, when the address stops working. */
        deadline,
        timeEstimate: quote.timeEstimate,
        correlationId: response.correlationId,
        signature: response.signature,
        rawResponse: response,
      },
    });
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: "awaiting_payment" } });
    /** Another open tab of the same checkout learns about the new address, and the refund address it was created with. */
    await notifyCheckout(tx, invoiceId);
    return row;
  });
  return { quote: created, destinationChain: invoice.destinationChain };
}
