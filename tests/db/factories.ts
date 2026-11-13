import { randomBytes } from "node:crypto";
import type { CreditAccount, Invoice, Merchant, Prisma, Quote, Transfer } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/ids";
import type { OneClickToken } from "@/lib/oneclick/types";

/** Row factories for the test database: each fills the required columns with plausible values that a test can override. */

export const USDC_BASE = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
export const ETH = "nep141:eth.omft.near";
export const USDC_SOLANA = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
export const PAYOUT_ADDRESS = "0x2222222222222222222222222222222222222222";

/** The 1Click token list a test mocks `findToken` and `listTokens` with, so pricing and coin checks never reach the network. */
export const TEST_TOKENS: OneClickToken[] = [
  { assetId: USDC_BASE, decimals: 6, blockchain: "base", symbol: "USDC", price: 1, priceUpdatedAt: "", contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  { assetId: ETH, decimals: 18, blockchain: "eth", symbol: "ETH", price: 3000, priceUpdatedAt: "" },
  { assetId: USDC_SOLANA, decimals: 6, blockchain: "sol", symbol: "USDC", price: 1, priceUpdatedAt: "", contractAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
];

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);

export function createMerchant(overrides: Partial<Prisma.MerchantUncheckedCreateInput> = {}): Promise<Merchant> {
  return getDb().merchant.create({
    data: {
      id: newId("mer"),
      name: "Northwind Coffee",
      settlementAsset: USDC_BASE,
      payoutChain: "base",
      payoutAddress: PAYOUT_ADDRESS,
      payoutVerifiedAt: new Date(),
      ...overrides,
    },
  });
}

export function createInvoice(merchant: Pick<Merchant, "id">, overrides: Partial<Prisma.InvoiceUncheckedCreateInput> = {}): Promise<Invoice> {
  return getDb().invoice.create({
    data: {
      id: newId("inv"),
      merchantId: merchant.id,
      mode: "live",
      status: "awaiting_payment",
      amount: "25.00",
      currency: "USD",
      destinationAsset: USDC_BASE,
      destinationSymbol: "USDC",
      destinationChain: "base",
      destinationDecimals: 6,
      amountOutBase: "25000000",
      expiresAt: minutesFromNow(60),
      ...overrides,
    },
  });
}

export function createQuote(invoice: Pick<Invoice, "id">, overrides: Partial<Prisma.QuoteUncheckedCreateInput> = {}): Promise<Quote> {
  return getDb().quote.create({
    data: {
      id: newId("quo"),
      invoiceId: invoice.id,
      originAsset: "nep141:eth.omft.near",
      originSymbol: "ETH",
      originChain: "eth",
      originDecimals: 18,
      depositAddress: `0x${randomBytes(20).toString("hex")}`,
      amountIn: "10000000000000000",
      amountInFormatted: "0.01",
      minAmountIn: "9900000000000000",
      refundTo: "0x1111111111111111111111111111111111111111",
      deadline: minutesFromNow(20),
      timeEstimate: 30,
      correlationId: newId("quo"),
      signature: "ed25519:test",
      rawResponse: {},
      nextPollAt: new Date(Date.now() - 1_000),
      ...overrides,
    },
  });
}

export function createTransfer(merchant: Pick<Merchant, "id">, overrides: Partial<Prisma.TransferUncheckedCreateInput> = {}): Promise<Transfer> {
  return getDb().transfer.create({
    data: {
      id: newId("pay"),
      merchantId: merchant.id,
      kind: "payout",
      amount: "10",
      sourceAsset: USDC_BASE,
      destinationAsset: USDC_BASE,
      recipient: "0x4444444444444444444444444444444444444444",
      ...overrides,
    },
  });
}

/** An agent's credit account with a random token hash; tests that charge it use `topUp`, which hands out the token. */
export function createCreditAccount(merchant: Pick<Merchant, "id">, overrides: Partial<Prisma.CreditAccountUncheckedCreateInput> = {}): Promise<CreditAccount> {
  return getDb().creditAccount.create({
    data: { id: newId("cra"), merchantId: merchant.id, tokenHash: randomBytes(32).toString("hex"), ...overrides },
  });
}

/** A payment event as NEAR Intents reports it, with the origin transaction hashes it saw. */
export function createPaymentEvent(quote: Pick<Quote, "id">, originHashes: string[], overrides: Partial<Prisma.PaymentEventUncheckedCreateInput> = {}) {
  return getDb().paymentEvent.create({
    data: {
      id: newId("pev"),
      quoteId: quote.id,
      oneclickStatus: "KNOWN_DEPOSIT_TX",
      originTxs: originHashes.map((hash) => ({ hash, explorerUrl: `https://etherscan.io/tx/${hash}` })),
      destinationTxs: [],
      ...overrides,
    },
  });
}
