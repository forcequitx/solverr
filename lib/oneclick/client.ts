import { z } from "zod";
import { OneClickStatus } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";
import { quoteProblem } from "@/lib/oneclick/quote-signature";
import type { OneClickToken, QuoteRequest, QuoteResponse, StatusResponse } from "@/lib/oneclick/types";

const TIMEOUT_MS = 10_000;
/** The token list is a large response that 1Click sometimes sends slowly. */
const TOKENS_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const BACKOFF_MS = 300;
const BUCKET_CAPACITY = 5;
const REFILL_PER_SECOND = 5;
/** Payment calls may use the whole bucket; dry estimates leave `reserve` slots free. No slot within `maxWaitMs` fails instead of queueing. */
const SLOT_RULES = {
  payment: { reserve: 0, maxWaitMs: 10_000 },
  estimate: { reserve: 2, maxWaitMs: 2_000 },
} as const;

type Priority = keyof typeof SLOT_RULES;

export class OneClickError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "OneClickError";
  }
}

/** This process gave up waiting for its own rate-limit slot: the request never reached 1Click, which says nothing about its health. */
export class OneClickSlotTimeout extends OneClickError {
  constructor(maxWaitMs: number) {
    super(`1Click request waited over ${maxWaitMs} ms for a rate-limit slot`);
    this.name = "OneClickSlotTimeout";
  }
}

/** A 1Click answer that refuses the request itself (a 4xx status), as opposed to an outage, a timeout (408) or throttling (429). */
export function isRefusal(error: unknown): error is OneClickError {
  return error instanceof OneClickError && error.status !== undefined && error.status < 500 && error.status !== 408 && error.status !== 429;
}

/** Uses the monotonic clock: a wall-clock step backwards would otherwise stall every 1Click call. */
const bucket = { tokens: BUCKET_CAPACITY, updatedAt: performance.now() };

/** Waits for a slot so this process stays under 5 requests per second to 1Click; the web server and the worker each keep their own bucket. */
async function takeSlot(priority: Priority): Promise<void> {
  const { reserve, maxWaitMs } = SLOT_RULES[priority];
  const start = performance.now();
  for (;;) {
    const now = performance.now();
    if (now - start > maxWaitMs) throw new OneClickSlotTimeout(maxWaitMs);
    bucket.tokens = Math.min(BUCKET_CAPACITY, bucket.tokens + ((now - bucket.updatedAt) / 1000) * REFILL_PER_SECOND);
    bucket.updatedAt = now;
    if (bucket.tokens >= 1 + reserve) {
      bucket.tokens -= 1;
      return;
    }
    await sleep(((1 + reserve - bucket.tokens) / REFILL_PER_SECOND) * 1000);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return text;
  }
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  { timeoutMs = TIMEOUT_MS, priority = "payment" }: { timeoutMs?: number; priority?: Priority } = {},
): Promise<T> {
  const { ONECLICK_BASE_URL, ONECLICK_API_KEY } = getEnv();
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (ONECLICK_API_KEY) headers["X-API-Key"] = ONECLICK_API_KEY;

  for (let attempt = 0; ; attempt++) {
    await takeSlot(priority);
    let response: Response;
    try {
      response = await fetch(new URL(path, ONECLICK_BASE_URL), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      /** The timeout also covers reading the body, so a slow download is retried like a slow connection. */
      if (response.ok) return (await response.json()) as T;
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        await sleep(BACKOFF_MS * 2 ** attempt);
        continue;
      }
      throw new OneClickError(`1Click ${method} ${path} unreachable: ${(error as Error).message}`);
    }

    if (response.status >= 500 && attempt < MAX_RETRIES) {
      await sleep(BACKOFF_MS * 2 ** attempt);
      continue;
    }
    throw new OneClickError(`1Click ${method} ${path} failed with ${response.status}`, response.status, await readBody(response));
  }
}

/** The amounts every quote answer carries; dry quotes are read only for these. */
const quoteAmountsSchema = z.looseObject({
  amountIn: z.string(),
  amountInFormatted: z.string(),
  amountInUsd: z.string().optional(),
});

/** The fields the app reads from a dry quote; other fields pass through unchecked. */
const estimateResponseSchema = z.looseObject({ quote: quoteAmountsSchema });

/** The fields the app reads from a real quote, which it stores as the payment's proof; other fields pass through unchecked. */
const quoteResponseSchema = z.looseObject({
  correlationId: z.string(),
  signature: z.string(),
  quote: quoteAmountsSchema.extend({
    minAmountIn: z.string(),
    timeEstimate: z.number().int(),
    depositAddress: z.string().optional(),
    depositMemo: z.string().optional(),
    deadline: z.string().optional(),
  }),
});

/** The status fields the app reads; a status outside the known set is refused before it reaches the database. */
const statusResponseSchema = z.looseObject({ status: z.enum(OneClickStatus), swapDetails: z.looseObject({}) });

/** Returns a 200 response body once it has the fields the app reads; anything else is an upstream failure. */
function checked<T>(schema: z.ZodType, value: unknown, path: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new OneClickError(`1Click ${path} response has an unexpected shape at ${result.error.issues[0]?.path.join(".") || "the top level"}`);
  return value as T;
}

export function fetchTokens(): Promise<OneClickToken[]> {
  return request<OneClickToken[]>("GET", "/v0/tokens", undefined, { timeoutMs: TOKENS_TIMEOUT_MS });
}

/** A real quote, used only when 1Click signed it for this exact request, since its deposit address receives the payment. */
export async function requestQuote(body: QuoteRequest): Promise<QuoteResponse> {
  const response = checked<QuoteResponse>(quoteResponseSchema, await request("POST", "/v0/quote", body), "/v0/quote");
  const problem = quoteProblem(body, response);
  if (problem) throw new OneClickError(`1Click quote refused: ${problem}`);
  return response;
}

/** A dry quote for ranking coins; it uses only spare request capacity, so it never delays a payment. */
export async function requestEstimate(body: QuoteRequest): Promise<QuoteResponse> {
  return checked(estimateResponseSchema, await request("POST", "/v0/quote", { ...body, dry: true }, { priority: "estimate" }), "/v0/quote");
}

export async function fetchStatus(depositAddress: string, depositMemo?: string | null): Promise<StatusResponse> {
  const query = new URLSearchParams({ depositAddress });
  if (depositMemo) query.set("depositMemo", depositMemo);
  return checked(statusResponseSchema, await request("GET", `/v0/status?${query}`), "/v0/status");
}

export async function submitDeposit(txHash: string, depositAddress: string, memo?: string | null): Promise<StatusResponse> {
  return checked(statusResponseSchema, await request("POST", "/v0/deposit/submit", { txHash, depositAddress, ...(memo ? { memo } : {}) }), "/v0/deposit/submit");
}

/** Message from a 1Click error body, bounded so it is safe to show or log. */
export function oneClickMessage(error: OneClickError): string {
  const body = error.body as { message?: unknown } | undefined;
  const message = typeof body?.message === "string" ? body.message : error.message;
  return message.slice(0, 200);
}
