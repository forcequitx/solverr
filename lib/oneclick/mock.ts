import { createHash, randomUUID } from "node:crypto";
import type { OneClickStatus, Quote as QuoteRow } from "@/generated/prisma/client";
import { randomToken } from "@/lib/ids";
import { formatBaseUnits, mulDivRound, numberToDecimal, toBaseUnits } from "@/lib/money";
import { TEST_DEPOSIT_PREFIX } from "@/lib/oneclick/test-deposit";
import { findToken } from "@/lib/oneclick/tokens";
import type { QuoteRequest, QuoteResponse, StatusResponse, SwapDetails } from "@/lib/oneclick/types";

/** Fee the test-mode stand-in for 1Click adds to quotes priced from live token prices; its payments move only through the Simulate panel. */
const NETWORK_FEE_BPS = 20n;
const STEP_MS = 4000;

/** Time until a simulated payment reaches its next step, so the worker checks it right then instead of on the usual schedule. */
export function simulatedStepDelay(simulatedAt: Date): number {
  return STEP_MS - ((Date.now() - simulatedAt.getTime()) % STEP_MS) + 50;
}

async function price(assetId: string): Promise<{ price: bigint; decimals: number }> {
  const token = await findToken(assetId);
  if (!token) throw new Error(`Unknown asset ${assetId}`);
  return { price: toBaseUnits(numberToDecimal(token.price), 12), decimals: token.decimals };
}

export async function mockQuote(request: QuoteRequest): Promise<QuoteResponse> {
  const origin = await price(request.originAsset);
  const destination = await price(request.destinationAsset);
  const amountOut = BigInt(request.amount);

  const usdOut = mulDivRound(amountOut, destination.price, 10n ** BigInt(destination.decimals));
  const minAmountIn = mulDivRound(mulDivRound(usdOut, 10n ** BigInt(origin.decimals), origin.price), 10_000n + NETWORK_FEE_BPS, 10_000n);
  const amountIn = mulDivRound(minAmountIn, 10_000n + BigInt(request.slippageTolerance), 10_000n);
  const usd = (value: bigint, p: { price: bigint; decimals: number }) =>
    formatBaseUnits(mulDivRound(value, p.price, 10n ** BigInt(p.decimals)), 12);

  return {
    correlationId: randomUUID(),
    timestamp: new Date().toISOString(),
    signature: `test:${randomToken(40)}`,
    quoteRequest: request,
    quote: {
      depositAddress: `${TEST_DEPOSIT_PREFIX}${randomToken(24)}`,
      depositMemo: request.depositMode === "MEMO" ? String(100_000_000 + Math.floor(Math.random() * 900_000_000)) : undefined,
      amountIn: amountIn.toString(),
      amountInFormatted: formatBaseUnits(amountIn, origin.decimals),
      amountInUsd: usd(amountIn, origin),
      minAmountIn: minAmountIn.toString(),
      amountOut: amountOut.toString(),
      amountOutFormatted: formatBaseUnits(amountOut, destination.decimals),
      amountOutUsd: formatBaseUnits(usdOut, 12),
      minAmountOut: amountOut.toString(),
      deadline: request.deadline,
      timeWhenInactive: request.deadline,
      timeEstimate: 20,
    },
  };
}

function fakeHash(quoteId: string, label: string): string {
  return `test_${createHash("sha256").update(`${quoteId}:${label}`).digest("hex").slice(0, 40)}`;
}

/** Status of a test quote, stepping through the simulated outcome over time. */
export function mockStatus(quote: QuoteRow): StatusResponse {
  const details: SwapDetails = { intentHashes: [], nearTxHashes: [], originChainTxHashes: [], destinationChainTxHashes: [] };
  let status: OneClickStatus = "PENDING_DEPOSIT";

  if (quote.simulatedOutcome && quote.simulatedAt) {
    const step = Math.floor((Date.now() - quote.simulatedAt.getTime()) / STEP_MS);
    const deposit = { hash: fakeHash(quote.id, "deposit"), explorerUrl: "" };
    details.originChainTxHashes = [deposit];

    if (quote.simulatedOutcome === "underpaid") {
      const sent = BigInt(quote.minAmountIn) / 2n;
      details.depositedAmount = sent.toString();
      details.depositedAmountFormatted = formatBaseUnits(sent, quote.originDecimals);
      status = step < 2 ? "INCOMPLETE_DEPOSIT" : "REFUNDED";
      if (status === "REFUNDED") {
        details.refundedAmount = sent.toString();
        details.refundedAmountFormatted = formatBaseUnits(sent, quote.originDecimals);
        details.refundReason = "PARTIAL_DEPOSIT";
      }
    } else {
      details.depositedAmount = quote.amountIn;
      details.depositedAmountFormatted = quote.amountInFormatted;
      const final: Record<typeof quote.simulatedOutcome, OneClickStatus> = { paid: "SUCCESS", refunded: "REFUNDED", failed: "FAILED" };
      status = step < 1 ? "KNOWN_DEPOSIT_TX" : step < 2 ? "PROCESSING" : final[quote.simulatedOutcome];
      if (status === "SUCCESS") details.destinationChainTxHashes = [{ hash: fakeHash(quote.id, "settle"), explorerUrl: "" }];
      if (status === "REFUNDED") {
        details.refundedAmount = quote.amountIn;
        details.refundedAmountFormatted = quote.amountInFormatted;
        details.refundReason = "SIMULATED_REFUND";
      }
    }
  }

  return { correlationId: quote.correlationId, quoteResponse: quote.rawResponse as QuoteResponse, status, updatedAt: new Date().toISOString(), swapDetails: details };
}
