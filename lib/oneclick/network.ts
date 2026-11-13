import type { Mode, Quote as QuoteRow } from "@/generated/prisma/client";
import { fetchStatus, requestEstimate, requestQuote, submitDeposit } from "@/lib/oneclick/client";
import { mockQuote, mockStatus } from "@/lib/oneclick/mock";
import type { QuoteRequest, QuoteResponse, StatusResponse } from "@/lib/oneclick/types";

type PaymentNetwork = {
  quote(request: QuoteRequest): Promise<QuoteResponse>;
  /** Dry quote for ranking coins; yields to payment calls when 1Click requests are busy. */
  estimate(request: QuoteRequest): Promise<QuoteResponse>;
  status(quote: QuoteRow): Promise<StatusResponse>;
  /** Reports a deposit transaction; returns the latest status. */
  reportDeposit(quote: QuoteRow, txHash: string): Promise<StatusResponse>;
};

const live: PaymentNetwork = {
  quote: requestQuote,
  estimate: requestEstimate,
  status: (quote) => fetchStatus(quote.depositAddress, quote.depositMemo),
  reportDeposit: (quote, txHash) => submitDeposit(txHash, quote.depositAddress, quote.depositMemo),
};

const test: PaymentNetwork = {
  quote: mockQuote,
  estimate: mockQuote,
  status: async (quote) => mockStatus(quote),
  reportDeposit: async (quote) => mockStatus(quote),
};

/** Live invoices talk to 1Click; test invoices (demo store only) use the in-process mock. */
export function paymentNetwork(mode: Mode): PaymentNetwork {
  return mode === "live" ? live : test;
}
