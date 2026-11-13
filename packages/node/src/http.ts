import { randomUUID } from "node:crypto";
import { MAX_RETRIES, MAX_RETRY_AFTER_RETRIES, MAX_RETRY_AFTER_SECONDS, REQUEST_TIMEOUT_MS, RETRY_BASE_DELAY_MS, SDK_VERSION } from "./config.js";
import { SolverrError } from "./errors.js";

type QueryValue = string | number | undefined;

export interface ApiRequest {
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, QueryValue>;
  body?: object;
  idempotencyKey?: string;
}

interface RawResponse {
  status: number;
  text: string;
  retryAfter: string | null;
  location: string | null;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Characters `fetch` refuses in a header value: NUL, line breaks, and anything above U+00FF (header values are bytes).
    Such a key fails before any request is sent, instead of as a connection error after every retry. */
const INVALID_HEADER_VALUE = /[\0\r\nĀ-￿]/;

/** An id as one URL path segment; empty, `.` and `..` are refused because the URL would point at another path. */
export function pathSegment(id: string): string {
  if (id === "" || id === "." || id === "..") throw new TypeError(`${JSON.stringify(id)} is not a valid id.`);
  return encodeURIComponent(id);
}

/** Why a request got no response, with the system error code (such as ECONNREFUSED) that `fetch` keeps in its cause. */
function connectionFailure(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") return `no response within ${REQUEST_TIMEOUT_MS / 1000} seconds`;
  const cause = error instanceof Error ? (error.cause as { code?: unknown; message?: unknown } | undefined) : undefined;
  if (typeof cause?.code === "string") return cause.code;
  if (typeof cause?.message === "string") return cause.message;
  return error instanceof Error ? error.message : String(error);
}

/** Exponential backoff with up to 25% random jitter. */
const retryDelay = (attempt: number) => RETRY_BASE_DELAY_MS * 2 ** attempt * (1 + Math.random() / 4);

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** `Retry-After` in seconds; only the delay-seconds form is read, as the API never sends an HTTP date. */
const retryAfterSeconds = (value: string | null) => (value && /^\d+$/.test(value) ? Number(value) : undefined);

function toApiError(response: RawResponse, payload: unknown): SolverrError {
  const { status } = response;
  const options = { retryAfter: retryAfterSeconds(response.retryAfter) };
  const error = (payload as { error?: Record<string, unknown> } | undefined)?.error;
  if (error && typeof error.type === "string" && typeof error.message === "string") {
    const text = (value: unknown) => (typeof value === "string" ? value : undefined);
    return new SolverrError(status, error.type, error.message, text(error.param), text(error.code), options);
  }
  return new SolverrError(status, "api_error", `Solverr returned HTTP ${status}.`, undefined, undefined, options);
}

/** Milliseconds to wait before retrying a 429 or an in-progress Idempotency-Key 409; undefined when it must not be retried. */
function retryAfterDelay(response: RawResponse, payload: unknown): number | undefined {
  const type = (payload as { error?: { type?: unknown } } | undefined)?.error?.type;
  const retryable = response.status === 429 || (response.status === 409 && type === "idempotency_conflict");
  const seconds = retryAfterSeconds(response.retryAfter);
  if (!retryable || seconds === undefined) return undefined;
  return seconds <= MAX_RETRY_AFTER_SECONDS ? seconds * 1000 : undefined;
}

/** Sends authenticated JSON requests, retrying network errors and 5xx responses, and 429s or in-progress 409s after a short `Retry-After`. */
export class HttpClient {
  readonly #apiKey: string;
  readonly #baseUrl: URL;

  constructor(apiKey: string, baseUrl: URL) {
    this.#apiKey = apiKey;
    this.#baseUrl = baseUrl;
  }

  async request<T>(request: ApiRequest): Promise<T> {
    const url = this.#url(request.path, request.query);
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${this.#apiKey}`,
      "user-agent": `solverr-node/${SDK_VERSION}`,
    };
    let body: string | undefined;
    if (request.method === "POST") {
      /** The same key is sent on every retry, so the server never applies a POST twice. */
      headers["idempotency-key"] = request.idempotencyKey ?? randomUUID();
      if (INVALID_HEADER_VALUE.test(headers["idempotency-key"])) throw new TypeError("idempotencyKey cannot contain line breaks, NUL or characters above U+00FF.");
      if (request.body !== undefined) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(request.body);
      }
    }

    let attempt = 0;
    let retryAfterRetries = 0;
    while (true) {
      const canRetry = attempt < MAX_RETRIES;
      let response: RawResponse;
      try {
        response = await this.#send(url, { method: request.method, headers, body });
      } catch (error) {
        if (canRetry) {
          await wait(retryDelay(attempt++));
          continue;
        }
        throw new SolverrError(0, "connection_error", `Could not reach Solverr at ${this.#baseUrl.origin}: ${connectionFailure(error)}`, undefined, undefined, { cause: error });
      }

      if (response.status >= 300 && response.status < 400) {
        const target = response.location ? ` to ${response.location}` : "";
        throw new SolverrError(response.status, "api_error", `Solverr answered with a redirect${target}. Set baseUrl to the address Solverr is served from.`);
      }
      if (response.status >= 500 && canRetry) {
        await wait(retryDelay(attempt++));
        continue;
      }
      const payload = parseJson(response.text);
      const retryAfterMs = retryAfterRetries < MAX_RETRY_AFTER_RETRIES ? retryAfterDelay(response, payload) : undefined;
      if (retryAfterMs !== undefined) {
        retryAfterRetries++;
        await wait(retryAfterMs);
        continue;
      }
      if (response.status < 200 || response.status >= 300) throw toApiError(response, payload);
      if (payload === undefined || payload === null) throw new SolverrError(response.status, "api_error", "Solverr returned a response that is not JSON.");
      return payload as T;
    }
  }

  /** One HTTP attempt; the timeout covers both the response headers and the body. */
  async #send(url: URL, init: RequestInit): Promise<RawResponse> {
    /** Redirects are not followed, so the API key is only ever sent to `baseUrl`. */
    const response = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return { status: response.status, text: await response.text(), retryAfter: response.headers.get("retry-after"), location: response.headers.get("location") };
  }

  #url(path: string, query: Record<string, QueryValue> = {}): URL {
    const url = new URL(this.#baseUrl.pathname.replace(/\/$/, "") + path, this.#baseUrl);
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }
    return url;
  }
}
