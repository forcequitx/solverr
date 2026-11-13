import { join } from "node:path";
import { PAYMENT_REQUIRED_HEADER, PAYMENT_SIGNATURE_HEADER, decodePaymentSignatureHeader } from "solverr-x402";
import { fetch } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentWallet, type AgentWallet, type AgentWalletOptions } from "../src/agent-wallet.js";
import { PaymentError } from "../src/errors.js";
import { GATEWAY, INVOICE_ID, challengeHeader, solverrExtra, tempDir } from "./fixtures.js";

const payer = vi.hoisted(() => ({ pay: vi.fn() }));

vi.mock("undici", async (importOriginal) => ({ ...(await importOriginal<typeof import("undici")>()), fetch: vi.fn() }));
vi.mock("../src/payer.js", () => ({
  Payer: class {
    pay = payer.pay;
  },
}));
vi.mock("../src/chains/base.js", () => ({
  BaseWallet: class {
    readonly blockchain = "base";
    readonly address = "0xA11CE00000000000000000000000000000000001";
  },
}));
vi.mock("../src/chains/near.js", () => ({
  NearWallet: class {
    readonly blockchain = "near";
    readonly address = "agent.near";
  },
}));

const fetchMock = vi.mocked(fetch);
const URL_TEXT = "https://api.example.com/data";

let dir: string;
let cleanup: () => Promise<void>;
let wallet: AgentWallet;

/** A wallet on the test gateway with a spend log in the test's folder; the timeouts are the only options tests change. */
const createWallet = (timeouts: Pick<AgentWalletOptions, "paymentTimeoutMs" | "resourceTimeoutMs"> = {}) =>
  createAgentWallet({
    base: { privateKey: `0x${"1".repeat(64)}` },
    limits: { perPaymentUsd: 5, dailyUsd: 20, allow: ["API.example.com"] },
    trustedGateways: [`${GATEWAY}/dashboard`],
    spendLogPath: join(dir, "spend-log.json"),
    ...timeouts,
  });

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  fetchMock.mockReset();
  payer.pay.mockReset().mockResolvedValue(undefined);
  wallet = createWallet();
});

afterEach(async () => {
  vi.useRealTimers();
  await cleanup();
});

const respond = (status: number, headers: Record<string, string> = {}) => new Response(status === 204 ? null : "body", { status, headers }) as never;
/** A 402 with a solverr challenge for `invoiceId` on the test gateway. */
const challenged = (invoiceId = INVOICE_ID) =>
  respond(402, { [PAYMENT_REQUIRED_HEADER]: challengeHeader(solverrExtra({ invoice_id: invoiceId, ...endpointsAt(GATEWAY, invoiceId) })) });
/** The invoice id inside the `PAYMENT-SIGNATURE` sent with fetch call `index`. */
const paidInvoice = (index: number) => (decodePaymentSignatureHeader(sent(index).signature!).payload as { invoice_id: string }).invoice_id;

/** The `PAYMENT-SIGNATURE` header and signal sent with fetch call `index`. */
function sent(index: number) {
  const init = fetchMock.mock.calls[index][1] as { headers?: Headers; signal?: AbortSignal };
  return { signature: init.headers?.get(PAYMENT_SIGNATURE_HEADER) ?? null, signal: init.signal };
}

/** Runs `run` with fake timers, advancing through every retry delay, and returns its result plus the fake time it took. */
async function withFakeTime<T>(run: () => Promise<T>): Promise<{ result: PromiseSettledResult<T>; elapsedMs: number }> {
  vi.useFakeTimers();
  const start = Date.now();
  const settled = Promise.allSettled([run()]);
  await vi.runAllTimersAsync();
  const [result] = await settled;
  return { result, elapsedMs: Date.now() - start };
}

describe("agent fetch", () => {
  it("returns a response that is not 402 untouched, with the caller's signal", async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(respond(200));
    const response = await wallet.fetch(URL_TEXT, { signal: controller.signal });
    expect(response.status).toBe(200);
    expect(sent(0).signal).toBe(controller.signal);
    expect(payer.pay).not.toHaveBeenCalled();
  });

  it("returns a 402 without a solverr challenge as it is", async () => {
    fetchMock.mockResolvedValueOnce(respond(402));
    expect((await wallet.fetch(URL_TEXT)).status).toBe(402);
    expect(payer.pay).not.toHaveBeenCalled();
  });

  it("refuses a challenge from an untrusted gateway before paying", async () => {
    fetchMock.mockResolvedValueOnce(respond(402, { [PAYMENT_REQUIRED_HEADER]: challengeHeader(solverrExtra(endpointsAt("https://evil.example.com"))) }));
    await expect(wallet.fetch(URL_TEXT)).rejects.toMatchObject({ code: "untrusted_gateway", fundsSent: false });
    expect(payer.pay).not.toHaveBeenCalled();
  });

  it("refuses a streamed body that cannot be sent again, before paying", async () => {
    fetchMock.mockResolvedValueOnce(challenged());
    const body = new ReadableStream({ start: (controller) => controller.close() });
    await expect(wallet.fetch(URL_TEXT, { method: "POST", body, duplex: "half" } as never)).rejects.toMatchObject({ code: "body_not_replayable" });
    expect(payer.pay).not.toHaveBeenCalled();
  });

  it("pays, then sends the request again with a PAYMENT-SIGNATURE for the invoice", async () => {
    fetchMock.mockResolvedValueOnce(challenged()).mockResolvedValueOnce(respond(200));
    const response = await wallet.fetch(URL_TEXT, { method: "POST", body: "{}", headers: { "x-custom": "1" } });
    expect(response.status).toBe(200);
    expect(payer.pay).toHaveBeenCalledWith(new URL(URL_TEXT), expect.objectContaining({ extra: expect.objectContaining({ invoice_id: INVOICE_ID }) }), undefined);
    const paid = fetchMock.mock.calls[1][1] as { method: string; body: string; headers: Headers };
    expect(paid).toMatchObject({ method: "POST", body: "{}" });
    expect(paid.headers.get("x-custom")).toBe("1");
    expect(decodePaymentSignatureHeader(sent(1).signature!)).toMatchObject({ x402Version: 2, payload: { invoice_id: INVOICE_ID } });
  });

  it("gives the first request and each paid attempt resourceTimeoutMs, 30 seconds by default", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValueOnce(challenged()).mockResolvedValueOnce(respond(200));
    await wallet.fetch(URL_TEXT);
    expect(timeout.mock.calls).toEqual([[30_000], [30_000]]);

    timeout.mockClear();
    wallet = createWallet({ resourceTimeoutMs: 120_000 });
    fetchMock.mockResolvedValueOnce(challenged()).mockResolvedValueOnce(respond(200));
    await wallet.fetch(URL_TEXT);
    expect(timeout.mock.calls).toEqual([[120_000], [120_000]]);
    timeout.mockRestore();
  });

  it("pays the URL that answered 402 after redirects and retries that URL", async () => {
    const redirected = challenged() as Response;
    Object.defineProperty(redirected, "url", { value: "https://api.example.com/final" });
    fetchMock.mockResolvedValueOnce(redirected as never).mockResolvedValueOnce(respond(200));
    await wallet.fetch(URL_TEXT);
    expect(payer.pay.mock.calls[0][0]).toEqual(new URL("https://api.example.com/final"));
    expect(fetchMock.mock.calls[1][0]).toEqual(new URL("https://api.example.com/final"));
  });

  it("sends the same payment again after a network error and a 429, waiting 1 s then 2 s", async () => {
    fetchMock.mockResolvedValueOnce(challenged()).mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(respond(429)).mockResolvedValueOnce(respond(200));
    const { result, elapsedMs } = await withFakeTime(() => wallet.fetch(URL_TEXT));
    expect(result).toMatchObject({ status: "fulfilled", value: { status: 200 } });
    expect(elapsedMs).toBe(3_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const signatures = [1, 2, 3].map((index) => sent(index).signature);
    expect(signatures[0]).toBeTruthy();
    expect(new Set(signatures).size).toBe(1);
    expect(payer.pay).toHaveBeenCalledTimes(1);
  });

  it("throws paid_request_failed with funds sent after three failed paid attempts", async () => {
    fetchMock.mockResolvedValueOnce(challenged()).mockResolvedValueOnce(respond(500)).mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(respond(502));
    const { result } = await withFakeTime(() => wallet.fetch(URL_TEXT));
    expect(result.status).toBe("rejected");
    const error = (result as PromiseRejectedResult).reason;
    expect(error).toBeInstanceOf(PaymentError);
    expect(error).toMatchObject({ code: "paid_request_failed", fundsSent: true, invoiceId: INVOICE_ID });
    expect(error.message).toContain("HTTP 502");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(payer.pay).toHaveBeenCalledTimes(1);
    expect(wallet.unusedInvoice(URL_TEXT)).toBe(INVOICE_ID);
  });

  it("waits for a 503's Retry-After before sending the payment again", async () => {
    fetchMock.mockResolvedValueOnce(challenged()).mockResolvedValueOnce(respond(503, { "Retry-After": "5" })).mockResolvedValueOnce(respond(200));
    const { result, elapsedMs } = await withFakeTime(() => wallet.fetch(URL_TEXT));
    expect(result).toMatchObject({ status: "fulfilled", value: { status: 200 } });
    expect(elapsedMs).toBe(5_000);
  });

  it("waits for a 429's Retry-After up to 60 s", async () => {
    fetchMock.mockResolvedValueOnce(challenged()).mockResolvedValueOnce(respond(429, { "Retry-After": "3600" })).mockResolvedValueOnce(respond(200));
    const { result, elapsedMs } = await withFakeTime(() => wallet.fetch(URL_TEXT));
    expect(result).toMatchObject({ status: "fulfilled", value: { status: 200 } });
    expect(elapsedMs).toBe(60_000);
  });

  it("keeps the backoff when Retry-After is shorter, and ignores it on other 5xx responses", async () => {
    fetchMock
      .mockResolvedValueOnce(challenged())
      .mockResolvedValueOnce(respond(502, { "Retry-After": "30" }))
      .mockResolvedValueOnce(respond(429, { "Retry-After": "1" }))
      .mockResolvedValueOnce(respond(200));
    const { elapsedMs } = await withFakeTime(() => wallet.fetch(URL_TEXT));
    expect(elapsedMs).toBe(3_000);
  });

  it("stops retrying when the wait would pass the payment timeout, and keeps the payment", async () => {
    wallet = createWallet({ paymentTimeoutMs: 10_000 });
    fetchMock.mockResolvedValueOnce(challenged()).mockResolvedValueOnce(respond(429, { "Retry-After": "30" }));
    const { result, elapsedMs } = await withFakeTime(() => wallet.fetch(URL_TEXT));
    expect(result).toMatchObject({ status: "rejected", reason: { code: "paid_request_failed", fundsSent: true, invoiceId: INVOICE_ID } });
    expect(elapsedMs).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(wallet.unusedInvoice(URL_TEXT)).toBe(INVOICE_ID);
  });

  it("throws at once with funds sent when the paid request answers 402, and keeps nothing", async () => {
    fetchMock.mockResolvedValueOnce(challenged()).mockResolvedValueOnce(respond(402));
    await expect(wallet.fetch(URL_TEXT)).rejects.toMatchObject({ code: "paid_request_failed", fundsSent: true, invoiceId: INVOICE_ID });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(wallet.unusedInvoice(URL_TEXT)).toBeUndefined();
  });

  it.each([400, 404, 409])("returns a %i to the paid request without retrying", async (status) => {
    fetchMock.mockResolvedValueOnce(challenged()).mockResolvedValueOnce(respond(status));
    expect((await wallet.fetch(URL_TEXT)).status).toBe(status);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores the caller's signal once the payment went through", async () => {
    const controller = new AbortController();
    payer.pay.mockImplementationOnce(async (_url: URL, _challenge: unknown, signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
    });
    fetchMock.mockResolvedValueOnce(challenged()).mockResolvedValueOnce(respond(200));
    const response = await wallet.fetch(URL_TEXT, { signal: controller.signal });
    expect(response.status).toBe(200);
    const paidSignal = sent(1).signal;
    expect(paidSignal).toBeDefined();
    expect(paidSignal).not.toBe(controller.signal);
    expect(paidSignal?.aborted).toBe(false);
  });

  it("passes payment errors through without sending the paid request", async () => {
    payer.pay.mockRejectedValueOnce(new PaymentError("daily_limit", "over"));
    fetchMock.mockResolvedValueOnce(challenged());
    await expect(wallet.fetch(URL_TEXT)).rejects.toMatchObject({ code: "daily_limit", fundsSent: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("unused paid invoices", () => {
  /** Pays inv_1 for a GET of URL_TEXT and gets a 404 back, which leaves the payment unused. */
  async function payAndGet404() {
    fetchMock.mockResolvedValueOnce(challenged()).mockResolvedValueOnce(respond(404));
    expect((await wallet.fetch(URL_TEXT)).status).toBe(404);
  }

  it("keeps a payment the site answered with an error, by method, origin and path", async () => {
    await payAndGet404();
    expect(wallet.unusedInvoice(URL_TEXT)).toBe(INVOICE_ID);
    expect(wallet.unusedInvoice(`${URL_TEXT}?page=2`, "get")).toBe(INVOICE_ID);
    expect(wallet.unusedInvoice(URL_TEXT, "POST")).toBeUndefined();
    expect(wallet.unusedInvoice("https://api.example.com/other")).toBeUndefined();
  });

  it("does not keep a payment the site accepted", async () => {
    fetchMock.mockResolvedValueOnce(challenged()).mockResolvedValueOnce(respond(204));
    await wallet.fetch(URL_TEXT);
    expect(wallet.unusedInvoice(URL_TEXT)).toBeUndefined();
  });

  it("sends the kept payment on the next 402 instead of paying, then forgets it once accepted", async () => {
    await payAndGet404();
    fetchMock.mockResolvedValueOnce(challenged("inv_2")).mockResolvedValueOnce(respond(200));
    expect((await wallet.fetch(URL_TEXT)).status).toBe(200);
    expect(payer.pay).toHaveBeenCalledTimes(1);
    expect(paidInvoice(3)).toBe(INVOICE_ID);
    expect(sent(3).signature).toBe(sent(1).signature);
    expect(wallet.unusedInvoice(URL_TEXT)).toBeUndefined();
  });

  it("keeps the payment when the site answers the resend with an error again", async () => {
    await payAndGet404();
    fetchMock.mockResolvedValueOnce(challenged("inv_2")).mockResolvedValueOnce(respond(409));
    expect((await wallet.fetch(URL_TEXT)).status).toBe(409);
    expect(payer.pay).toHaveBeenCalledTimes(1);
    expect(wallet.unusedInvoice(URL_TEXT)).toBe(INVOICE_ID);
  });

  it("drops the payment the site refuses with 402 and pays the new invoice", async () => {
    await payAndGet404();
    fetchMock.mockResolvedValueOnce(challenged("inv_2")).mockResolvedValueOnce(respond(402)).mockResolvedValueOnce(respond(200));
    expect((await wallet.fetch(URL_TEXT)).status).toBe(200);
    expect(payer.pay).toHaveBeenCalledTimes(2);
    expect(payer.pay.mock.calls[1][1]).toMatchObject({ extra: { invoice_id: "inv_2" } });
    expect([paidInvoice(3), paidInvoice(4)]).toEqual([INVOICE_ID, "inv_2"]);
    expect(wallet.unusedInvoice(URL_TEXT)).toBeUndefined();
  });

  it("pays anew for another method on the same URL", async () => {
    await payAndGet404();
    fetchMock.mockResolvedValueOnce(challenged("inv_2")).mockResolvedValueOnce(respond(200));
    await wallet.fetch(URL_TEXT, { method: "POST", body: "{}" });
    expect(payer.pay).toHaveBeenCalledTimes(2);
    expect(paidInvoice(3)).toBe("inv_2");
    expect(wallet.unusedInvoice(URL_TEXT)).toBe(INVOICE_ID);
  });

  it("does not send a kept payment to a host the limits no longer allow", async () => {
    await payAndGet404();
    wallet.setLimits({ allow: ["other.example.com"] });
    payer.pay.mockRejectedValueOnce(new PaymentError("host_not_allowed", "not allowed"));
    fetchMock.mockResolvedValueOnce(challenged("inv_2"));
    await expect(wallet.fetch(URL_TEXT)).rejects.toMatchObject({ code: "host_not_allowed" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(wallet.unusedInvoice(URL_TEXT)).toBe(INVOICE_ID);
  });
});

describe("agent wallet setup", () => {
  it("normalizes limits and changes them through setLimits", async () => {
    expect(wallet.setLimits({ dailyUsd: 3, allow: [" Other.Example.com "] })).toEqual({ perPaymentUsd: 5, dailyUsd: 3, allow: ["other.example.com"] });
    await expect(wallet.spending()).resolves.toMatchObject({ limits: { dailyUsd: 3 }, spent_last_24h_usd: 0, remaining_today_usd: 3, recent: [] });
  });

  it("refuses invalid limits in setLimits", () => {
    expect(() => wallet.setLimits({ perPaymentUsd: -1 })).toThrow("perPaymentUsd");
  });

  it("needs a wallet and a trusted gateway", () => {
    const limits = { perPaymentUsd: 1, dailyUsd: 1, allow: [] };
    expect(() => createAgentWallet({ limits, trustedGateways: [GATEWAY] })).toThrow("Configure at least one wallet");
    expect(() => createAgentWallet({ base: { privateKey: "0x" }, limits, trustedGateways: [] })).toThrow("trustedGateways");
  });
});

/** Endpoint fields of a challenge for `invoiceId` whose gateway is `origin`. */
function endpointsAt(origin: string, invoiceId = INVOICE_ID) {
  const root = `${origin}/api/v1/invoices/${invoiceId}`;
  return { quote_url: `${root}/quote`, deposit_url: `${root}/deposit`, status_url: `${root}/status` };
}
