const DEFAULT_TIMEOUT_MS = 10_000;
export const RETRY_BASE_DELAY_MS = 300;
/** Longest `Retry-After` wait honored between attempts; a longer one is returned as an error. */
const MAX_RETRY_AFTER_MS = 5_000;
const MAX_ERROR_MESSAGE_LENGTH = 300;
/** Hosts that may be reached over plain http, for local development; every other host needs https. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Parses a URL that receives credentials; throws unless it is https, or http on localhost. */
export function secureUrl(value: string, name: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    throw new Error(`${name} must be an https URL (http only for localhost).`);
  }
  return url;
}

/** Error returned by the Solverr API (`{ error: { type, message, param, code } }`) or a transport failure (`status` undefined). */
export class SolverrApiError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly type: string,
    readonly param?: string,
    /** Finer reason inside `type`, such as `invoice_paid`, when the API sends one. */
    readonly code?: string,
  ) {
    super(message);
    this.name = "SolverrApiError";
  }
}

export interface JsonRequest {
  method: "GET" | "POST";
  url: string;
  /** Sent as `Authorization: Bearer …`. */
  apiKey?: string;
  body?: unknown;
  timeoutMs?: number;
  /** Extra attempts after a network error, timeout, non-JSON success body, 429, 5xx, or 409 while the same Idempotency-Key is in progress.
      A POST sends one generated Idempotency-Key on every attempt, so a retry replays the first result instead of repeating it. */
  retries?: number;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 429, 5xx, or 409 `idempotency_conflict` with `Retry-After`, which Solverr sends while the same Idempotency-Key is still running. */
const isRetryable = (response: Response, error: SolverrApiError) =>
  response.status === 429 ||
  response.status >= 500 ||
  (response.status === 409 && error.type === "idempotency_conflict" && response.headers.has("Retry-After"));

async function errorFromResponse(response: Response): Promise<SolverrApiError> {
  let type = "http_error";
  let message = `Solverr API responded with HTTP ${response.status}.`;
  let param: string | undefined;
  let code: string | undefined;
  try {
    const body = (await response.json()) as { error?: { type?: unknown; message?: unknown; param?: unknown; code?: unknown } };
    if (typeof body.error?.type === "string") type = body.error.type;
    if (typeof body.error?.message === "string") message = body.error.message.slice(0, MAX_ERROR_MESSAGE_LENGTH);
    if (typeof body.error?.param === "string") param = body.error.param;
    if (typeof body.error?.code === "string") code = body.error.code;
  } catch {
    /** Non-JSON error bodies keep the generic message. */
  }
  return new SolverrApiError(message, response.status, type, param, code);
}

/** Sends a JSON request with a per-attempt timeout and bounded retries, and returns the parsed JSON body. */
export async function requestJson<T>(request: JsonRequest): Promise<T> {
  const retries = request.retries ?? 0;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (request.apiKey) headers.Authorization = `Bearer ${request.apiKey}`;
  if (request.body !== undefined) headers["Content-Type"] = "application/json";
  if (request.method === "POST") headers["Idempotency-Key"] = crypto.randomUUID();

  let lastError: SolverrApiError | undefined;
  let retryAfterMs = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.max(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), retryAfterMs));
    retryAfterMs = 0;
    let response: Response;
    try {
      response = await fetch(request.url, {
        method: request.method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        redirect: "manual",
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      lastError = new SolverrApiError(timedOut ? "Solverr API did not respond in time." : "Could not reach the Solverr API.", undefined, timedOut ? "timeout" : "network_error");
      continue;
    }
    /** Redirects are not followed, so the API key only goes to the configured address; one is named instead of looking like an outage. */
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      const location = response.headers.get("Location");
      const target = location ? ` to ${location.slice(0, MAX_ERROR_MESSAGE_LENGTH)}` : "";
      throw new SolverrApiError(`Solverr answered with a redirect${target}. Set baseUrl to the address Solverr is served from.`, response.status, "redirect");
    }
    if (response.ok) {
      try {
        return (await response.json()) as T;
      } catch {
        lastError = new SolverrApiError("Solverr API answered with a body that is not JSON.", response.status, "invalid_response");
        continue;
      }
    }
    lastError = await errorFromResponse(response);
    if (!isRetryable(response, lastError)) throw lastError;
    retryAfterMs = Number(response.headers.get("Retry-After") ?? 0) * 1000 || 0;
    if (retryAfterMs > MAX_RETRY_AFTER_MS) throw lastError;
  }
  throw lastError ?? new SolverrApiError("Could not reach the Solverr API.", undefined, "network_error");
}
