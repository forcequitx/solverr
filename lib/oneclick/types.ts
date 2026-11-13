import type { OneClickStatus } from "@/generated/prisma/client";

/** Token entry from 1Click `GET /v0/tokens`. */
export type OneClickToken = {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  priceUpdatedAt: string;
  contractAddress?: string;
  coingeckoId?: string;
};

/** 1Click quote confidentiality; `basic` and `advanced` route the swap through Confidential Intents. */
export type Confidentiality = "public" | "basic" | "advanced";

/** Body of 1Click `POST /v0/quote`. Solverr never sends `appFees`. */
export type QuoteRequest = {
  dry: boolean;
  depositMode: "SIMPLE" | "MEMO";
  swapType: "EXACT_OUTPUT" | "EXACT_INPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN";
  destinationAsset: string;
  amount: string;
  refundTo: string;
  /** `INTENTS` refunds to a NEAR Intents account; used only for dry checks made before the payer gives a refund address. */
  refundType: "ORIGIN_CHAIN" | "INTENTS";
  recipient: string;
  recipientType: "DESTINATION_CHAIN";
  deadline: string;
  referral: string;
  confidentiality?: Confidentiality;
};

type Quote = {
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  minAmountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  /** When the deposit address stops working (days after the requested deadline, when refunds start); not the payment window. */
  deadline?: string;
  timeWhenInactive?: string;
  timeEstimate: number;
  refundFee?: string;
  withdrawFee?: string;
};

export type QuoteResponse = {
  correlationId: string;
  timestamp: string;
  signature: string;
  quoteRequest: QuoteRequest;
  quote: Quote;
};

export type TransactionDetails = { hash: string; explorerUrl: string };

export type SwapDetails = {
  intentHashes: string[];
  nearTxHashes: string[];
  amountIn?: string;
  amountInFormatted?: string;
  amountOut?: string;
  amountOutFormatted?: string;
  originChainTxHashes: TransactionDetails[];
  destinationChainTxHashes: TransactionDetails[];
  refundedAmount?: string;
  refundedAmountFormatted?: string;
  refundReason?: string;
  depositedAmount?: string;
  depositedAmountFormatted?: string;
};

/** Response of `GET /v0/status` and `POST /v0/deposit/submit`. */
export type StatusResponse = {
  correlationId: string;
  /** The quote this deposit address was issued with; its `quote.refundFee` is what a refund costs. */
  quoteResponse?: QuoteResponse;
  status: OneClickStatus;
  updatedAt: string;
  swapDetails: SwapDetails;
};
