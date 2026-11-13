import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REQUEST_TIMEOUT_MS, SDK_VERSION } from "../src/config.js";
import { pathSegment } from "../src/http.js";
import { SolverrError } from "../src/index.js";
import { API_KEY, apiError, attempt, client, json, mockFetch, networkError, settle } from "./fetch-mock.js";

const IDEMPOTENCY_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Runs a request to completion while the fake clock skips every retry wait. */
async function run<T>(promise: Promise<T>) {
  const result = settle(promise);
  await vi.runAllTimersAsync();
  return result;
}

function solverrError(error: unknown): SolverrError {
  expect(error).toBeInstanceOf(SolverrError);
  return error as SolverrError;
}

describe("request headers and body", () => {
  it("sends the API key as a bearer token with JSON accept and the SDK user agent", async () => {
    const { calls } = mockFetch(json({ id: "inv_1" }));
    await client().invoices.retrieve("inv_1");
    expect(calls[0]?.headers).toEqual({
      accept: "application/json",
      authorization: `Bearer ${API_KEY}`,
      "user-agent": `solverr-node/${SDK_VERSION}`,
    });
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.body).toBeUndefined();
  });

  it("gives a POST a random Idempotency-Key and a JSON body", async () => {
    const { calls } = mockFetch(json({ id: "inv_1" }), json({ id: "inv_2" }));
    await client().invoices.create({ amount: "10.00", currency: "USD" });
    await client().invoices.create({ amount: "10.00", currency: "USD" });
    expect(calls[0]?.headers["content-type"]).toBe("application/json");
    expect(calls[0]?.body).toBe(JSON.stringify({ amount: "10.00", currency: "USD" }));
    expect(calls[0]?.headers["idempotency-key"]).toMatch(IDEMPOTENCY_KEY);
    expect(calls[1]?.headers["idempotency-key"]).toMatch(IDEMPOTENCY_KEY);
    expect(calls[0]?.headers["idempotency-key"]).not.toBe(calls[1]?.headers["idempotency-key"]);
  });

  it("uses the caller's Idempotency-Key when one is given", async () => {
    const { calls } = mockFetch(json({ id: "inv_1" }));
    await client().invoices.create({ amount: "1", currency: "USD" }, { idempotencyKey: "order-42" });
    expect(calls[0]?.headers["idempotency-key"]).toBe("order-42");
  });

  it("sends a POST without a body with no content type", async () => {
    const { calls } = mockFetch(json({ id: "inv_1" }));
    await client().invoices.redeem("inv_1");
    expect(calls[0]?.headers["idempotency-key"]).toMatch(IDEMPOTENCY_KEY);
    expect(calls[0]?.headers["content-type"]).toBeUndefined();
    expect(calls[0]?.body).toBeUndefined();
  });

  it.each(["key\r\nx-evil: 1", "key\nx", "key\0x", "order-€1", "order-Ā", "order-😀"])(
    "refuses an Idempotency-Key with a line break, NUL or a character above U+00FF (%j) before sending",
    async (key) => {
      const { fetchStub } = mockFetch(json({}));
      const create = client().invoices.create({ amount: "1", currency: "USD" }, { idempotencyKey: key });
      await expect(create).rejects.toThrow(new TypeError("idempotencyKey cannot contain line breaks, NUL or characters above U+00FF."));
      expect(fetchStub).not.toHaveBeenCalled();
    },
  );

  it("sends an Idempotency-Key with Latin-1 characters, which header values allow", async () => {
    const { calls } = mockFetch(json({ id: "inv_1" }));
    await client().invoices.create({ amount: "1", currency: "USD" }, { idempotencyKey: "commande-ÿé" });
    expect(calls[0]?.headers["idempotency-key"]).toBe("commande-ÿé");
  });

  it("rejects in fetch the same characters the SDK refuses", () => {
    expect(() => new Headers({ "idempotency-key": "order-€1" })).toThrow(TypeError);
    expect(new Headers({ "idempotency-key": "commande-ÿé" }).get("idempotency-key")).toBe("commande-ÿé");
  });

  it("asks fetch not to follow redirects", async () => {
    const { calls } = mockFetch(json({ id: "inv_1" }));
    await client().invoices.retrieve("inv_1");
    expect(calls[0]?.redirect).toBe("manual");
  });

  it("leaves out query values that are undefined", async () => {
    const { calls } = mockFetch(json({ object: "list", data: [], has_more: false }));
    await client().invoices.list({ limit: 5, status: undefined });
    expect(calls[0]?.url).toBe("https://pay.example.com/api/v1/invoices?limit=5");
  });
});

describe("path segments", () => {
  it("encodes characters that would change the URL", () => {
    expect(pathSegment("inv_1")).toBe("inv_1");
    expect(pathSegment("a/b?c#d")).toBe("a%2Fb%3Fc%23d");
    expect(pathSegment("../x")).toBe("..%2Fx");
  });

  it.each(["", ".", ".."])("refuses the id %j", (id) => {
    expect(() => pathSegment(id)).toThrow(TypeError);
  });

  it("sends an encoded id as one path segment", async () => {
    const { calls } = mockFetch(json({ id: "x" }));
    await client().invoices.retrieve("../payouts");
    expect(calls[0]?.url).toBe("https://pay.example.com/api/v1/invoices/..%2Fpayouts");
  });

  it("refuses `..` as an id without sending a request", async () => {
    const { fetchStub } = mockFetch(json({}));
    await expect(attempt(() => client().refunds.retrieve(".."))).rejects.toThrow(TypeError);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe("retries", () => {
  it("retries a network error with the same Idempotency-Key and returns the later success", async () => {
    const { calls } = mockFetch(networkError(), networkError(), json({ id: "inv_1" }));
    const { value } = await run(client().invoices.create({ amount: "1", currency: "USD" }));
    expect(value).toEqual({ id: "inv_1" });
    expect(calls).toHaveLength(3);
    const keys = new Set(calls.map((call) => call.headers["idempotency-key"]));
    expect(keys.size).toBe(1);
  });

  it("gives up after two retries with a connection error that names the system code", async () => {
    const { calls } = mockFetch(networkError("ECONNREFUSED"));
    const { error } = await run(client().invoices.retrieve("inv_1"));
    const failure = solverrError(error);
    expect(calls).toHaveLength(3);
    expect(failure.status).toBe(0);
    expect(failure.type).toBe("connection_error");
    expect(failure.message).toContain("https://pay.example.com");
    expect(failure.message).toContain("ECONNREFUSED");
    expect(failure.cause).toBeInstanceOf(TypeError);
  });

  it("waits with growing backoff between network retries", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { fetchStub } = mockFetch(networkError(), networkError(), json({ id: "inv_1" }));
    const result = settle(client().invoices.retrieve("inv_1"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchStub).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchStub).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchStub).toHaveBeenCalledTimes(3);
    expect((await result).value).toEqual({ id: "inv_1" });
  });

  it("retries a 5xx with the same Idempotency-Key", async () => {
    const { calls } = mockFetch(apiError(503, "api_error", "busy"), json({ id: "po_1" }));
    const { value } = await run(client().payouts.create({ amount: "5", asset_id: "nep141:usdc", recipient: "alice.near" }));
    expect(value).toEqual({ id: "po_1" });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.headers["idempotency-key"]).toBe(calls[1]?.headers["idempotency-key"]);
  });

  it("returns the last 5xx as an error after two retries", async () => {
    const { calls } = mockFetch(apiError(500, "api_error", "Something broke."));
    const failure = solverrError((await run(client().invoices.retrieve("inv_1"))).error);
    expect(calls).toHaveLength(3);
    expect(failure.status).toBe(500);
    expect(failure.message).toBe("Something broke.");
  });

  it.each([400, 401, 403, 404, 422])("does not retry a %i", async (status) => {
    const { calls } = mockFetch(apiError(status, "invalid_request", "No."));
    const failure = solverrError((await run(client().invoices.retrieve("inv_1"))).error);
    expect(calls).toHaveLength(1);
    expect(failure.status).toBe(status);
  });

  it("waits the Retry-After seconds of a 429, then retries with the same key", async () => {
    const { calls, fetchStub } = mockFetch(apiError(429, "rate_limited", "Slow down.", {}, { "retry-after": "2" }), json({ id: "inv_1" }));
    const result = settle(client().invoices.create({ amount: "1", currency: "USD" }));
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect((await result).value).toEqual({ id: "inv_1" });
    expect(calls[0]?.headers["idempotency-key"]).toBe(calls[1]?.headers["idempotency-key"]);
  });

  it("waits up to 10 seconds of Retry-After", async () => {
    const { calls } = mockFetch(apiError(429, "rate_limited", "Slow down.", {}, { "retry-after": "10" }), json({ id: "inv_1" }));
    const { value } = await run(client().invoices.retrieve("inv_1"));
    expect(value).toEqual({ id: "inv_1" });
    expect(calls).toHaveLength(2);
  });

  it("returns a 429 whose Retry-After is over 10 seconds as an error carrying the wait", async () => {
    const { calls } = mockFetch(apiError(429, "rate_limited", "Slow down.", {}, { "retry-after": "11" }));
    const failure = solverrError((await run(client().invoices.retrieve("inv_1"))).error);
    expect(calls).toHaveLength(1);
    expect(failure.status).toBe(429);
    expect(failure.retryAfter).toBe(11);
  });

  it.each([["missing", undefined], ["an HTTP date", "Wed, 21 Oct 2026 07:28:00 GMT"], ["a fraction", "1.5"]])(
    "does not retry a 429 whose Retry-After is %s",
    async (_label, retryAfter) => {
      const { calls } = mockFetch(apiError(429, "rate_limited", "Slow down.", {}, retryAfter ? { "retry-after": retryAfter } : {}));
      const failure = solverrError((await run(client().invoices.retrieve("inv_1"))).error);
      expect(calls).toHaveLength(1);
      expect(failure.retryAfter).toBeUndefined();
    },
  );

  it("stops retrying a 429 after three Retry-After waits", async () => {
    const { calls } = mockFetch(apiError(429, "rate_limited", "Slow down.", {}, { "retry-after": "1" }));
    const failure = solverrError((await run(client().invoices.retrieve("inv_1"))).error);
    expect(calls).toHaveLength(4);
    expect(failure.status).toBe(429);
    expect(failure.retryAfter).toBe(1);
  });

  it("retries a 409 for a key still in progress after its Retry-After, with the same key", async () => {
    const { calls } = mockFetch(apiError(409, "idempotency_conflict", "In progress.", {}, { "retry-after": "1" }), json({ id: "rf_1" }));
    const { value } = await run(client().refunds.create({ invoice_id: "inv_1" }));
    expect(value).toEqual({ id: "rf_1" });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.headers["idempotency-key"]).toBe(calls[1]?.headers["idempotency-key"]);
  });

  it("does not retry any other 409, even with Retry-After", async () => {
    const { calls } = mockFetch(apiError(409, "invalid_state", "Already paid.", { code: "invoice_paid" }, { "retry-after": "1" }));
    const failure = solverrError((await run(client().invoices.redeem("inv_1"))).error);
    expect(calls).toHaveLength(1);
    expect(failure.type).toBe("invalid_state");
    expect(failure.code).toBe("invoice_paid");
  });
});

describe("timeout", () => {
  /** Node's AbortSignal.timeout ignores fake timers, so it is rebuilt on the faked setTimeout. */
  function fakeTimeoutSignals() {
    return vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("The operation timed out.", "TimeoutError")), ms);
      return controller.signal;
    });
  }

  /** A response whose headers arrive at once but whose body never finishes until the request is aborted. */
  function stalledBody(signal: AbortSignal | undefined): Response {
    const response = new Response(null, { status: 200 });
    vi.spyOn(response, "text").mockImplementation(
      () => new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason))),
    );
    return response;
  }

  it("covers the body read, not only the headers, and fails after every attempt times out", async () => {
    const timeout = fakeTimeoutSignals();
    const { calls } = mockFetch((call) => stalledBody(call.signal));
    const result = settle(client().invoices.retrieve("inv_1"));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(calls).toHaveLength(1);
    await vi.runAllTimersAsync();
    const failure = solverrError((await result).error);
    expect(calls).toHaveLength(3);
    expect(timeout).toHaveBeenCalledTimes(3);
    expect(timeout).toHaveBeenCalledWith(REQUEST_TIMEOUT_MS);
    expect(failure.type).toBe("connection_error");
    expect(failure.message).toContain(`no response within ${REQUEST_TIMEOUT_MS / 1000} seconds`);
  });

  it("gives each attempt its own timeout signal", async () => {
    fakeTimeoutSignals();
    const { calls } = mockFetch((call) => stalledBody(call.signal), json({ id: "inv_1" }));
    const result = settle(client().invoices.retrieve("inv_1"));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1000);
    expect((await result).value).toEqual({ id: "inv_1" });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(calls[1]?.signal?.aborted).toBe(false);
  });
});

describe("responses", () => {
  it.each([301, 302, 307, 308])("refuses a %i redirect without following or retrying it", async (status) => {
    const { calls } = mockFetch(new Response(null, { status, headers: { location: "https://evil.example/steal" } }));
    const failure = solverrError((await run(client().invoices.retrieve("inv_1"))).error);
    expect(calls).toHaveLength(1);
    expect(failure.status).toBe(status);
    expect(failure.message).toContain("https://evil.example/steal");
    expect(failure.message).toContain("baseUrl");
  });

  it("reads type, message, param and code from an API error", async () => {
    mockFetch(apiError(400, "invalid_request", "amount is required.", { param: "amount", code: "missing" }, { "retry-after": "3" }));
    const failure = solverrError((await run(client().invoices.create({ amount: "", currency: "USD" }))).error);
    expect(failure).toMatchObject({
      name: "SolverrError",
      status: 400,
      type: "invalid_request",
      message: "amount is required.",
      param: "amount",
      code: "missing",
      retryAfter: 3,
    });
  });

  it("ignores non-string param and code fields", async () => {
    mockFetch(json({ error: { type: "invalid_request", message: "Bad.", param: 5, code: { x: 1 } } }, 400));
    const failure = solverrError((await run(client().invoices.retrieve("inv_1"))).error);
    expect(failure.param).toBeUndefined();
    expect(failure.code).toBeUndefined();
  });

  it("falls back to api_error with the status when the error body is not the API's shape", async () => {
    mockFetch(new Response("<html>Not found</html>", { status: 404 }));
    const failure = solverrError((await run(client().invoices.retrieve("inv_1"))).error);
    expect(failure.status).toBe(404);
    expect(failure.type).toBe("api_error");
    expect(failure.message).toBe("Solverr returned HTTP 404.");
  });

  it.each([["HTML", "<html></html>"], ["an empty body", ""], ["null", "null"]])("refuses a 200 whose body is %s", async (_label, text) => {
    mockFetch(new Response(text, { status: 200 }));
    const failure = solverrError((await run(client().invoices.retrieve("inv_1"))).error);
    expect(failure.status).toBe(200);
    expect(failure.message).toMatch(/not JSON/);
  });
});

describe("SolverrError", () => {
  it("keeps every field and the cause", () => {
    const cause = new Error("root");
    const error = new SolverrError(429, "rate_limited", "Slow down.", "amount", "too_many", { cause, retryAfter: 4 });
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: "SolverrError", status: 429, type: "rate_limited", message: "Slow down.", param: "amount", code: "too_many", retryAfter: 4 });
    expect(error.cause).toBe(cause);
  });

  it("leaves optional fields undefined", () => {
    const error = new SolverrError(0, "connection_error", "Down.");
    expect(error.param).toBeUndefined();
    expect(error.code).toBeUndefined();
    expect(error.retryAfter).toBeUndefined();
  });
});
