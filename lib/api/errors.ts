import { ZodError, type ZodType } from "zod";
import { reportError } from "@/lib/error-reports";
import { errorMessage, logger } from "@/lib/logger";
import { OneClickError } from "@/lib/oneclick/client";

const log = logger.child({ module: "api" });

type ApiErrorType =
  | "invalid_request"
  | "authentication_failed"
  | "not_found"
  | "invalid_state"
  | "already_redeemed"
  | "insufficient_credit"
  | "quote_unavailable"
  | "idempotency_conflict"
  | "rate_limited"
  | "upstream_unavailable"
  | "internal_error";

/** Finer reason inside an error type, for clients that show their own text. */
type ApiErrorCode = "invoice_paid" | "invoice_expired" | "payment_in_progress" | "payout_changed" | "too_many_attempts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly type: ApiErrorType,
    message: string,
    readonly param?: string,
    /** Seconds until the client may retry; sent as `Retry-After`. */
    readonly retryAfter?: number,
    readonly code?: ApiErrorCode,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function errorBody(error: ApiError) {
  return { error: { type: error.type, ...(error.code ? { code: error.code } : {}), message: error.message, ...(error.param ? { param: error.param } : {}) } };
}

/** Validates input with a Zod schema and turns the first issue into a 400 error. */
export function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  try {
    return schema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      /** An unknown field is named in `keys`, not in the path, so it is added to the path to point at it. */
      const path = issue.code === "unrecognized_keys" ? [...issue.path, issue.keys[0]] : issue.path;
      const param = path.join(".") || undefined;
      throw new ApiError(400, "invalid_request", issue.message, param);
    }
    throw error;
  }
}

/** Postgres codes for text it cannot store: a NUL character, or an invalid byte sequence (22021), and `\u0000` in JSON (22P05). */
const UNSTORABLE_TEXT_CODES: ReadonlySet<string> = new Set(["22021", "22P05"]);

/** Whether Postgres refused the request's text itself, which only the client's input can cause. */
function isUnstorableText(error: unknown): boolean {
  const cause = (error as { meta?: { driverAdapterError?: { cause?: { code?: unknown } } } } | null)?.meta?.driverAdapterError?.cause;
  return typeof cause?.code === "string" && UNSTORABLE_TEXT_CODES.has(cause.code);
}

/** Keeps an ApiError; unstorable text becomes a 400, a 1Click failure a logged 502, anything else a logged and reported generic 500. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (isUnstorableText(error)) return new ApiError(400, "invalid_request", "The request contains a NUL character or other text that cannot be stored.");
  if (error instanceof OneClickError) {
    log.error({ error: errorMessage(error) }, "1Click request failed");
    return new ApiError(502, "upstream_unavailable", "The payment network is not responding. Try again shortly.");
  }
  log.error({ error: errorMessage(error) }, "Unexpected error");
  reportError(error);
  return new ApiError(500, "internal_error", "Something went wrong. Try again shortly.");
}

/** Response headers that keep browsers and proxies from caching the answer. */
export const NO_STORE = { "Cache-Control": "no-store" };

/** The JSON error response for any thrown error; a 401 names the Bearer scheme and a rate limit carries Retry-After. */
export function errorResponse(error: unknown): Response {
  const apiError = toApiError(error);
  const headers: Record<string, string> = {
    ...(apiError.status === 401 ? { "WWW-Authenticate": "Bearer" } : {}),
    ...(apiError.retryAfter ? { "Retry-After": String(apiError.retryAfter) } : {}),
  };
  return Response.json(errorBody(apiError), { status: apiError.status, headers });
}

/** Runs a route handler and converts thrown errors to JSON error responses. */
export async function handleRoute(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    return errorResponse(error);
  }
}
