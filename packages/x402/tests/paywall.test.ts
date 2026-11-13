import type { PaymentRequired, SettleResponse } from "@x402/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryClaimStore, type ClaimStore } from "../src/claim-store.js";
import { exactRequirements } from "../src/exact.js";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "../src/index.js";
import { paywall, type PaywallOptions } from "../src/paywall.js";
import { RedisClaimStore } from "../src/redis-claim-store.js";
import { FakeApi, SOLVERR_URL } from "./fake-api.js";
import { FakeRedis } from "./fakes.js";
import { EXACT, exactPayment, invoicePayment } from "./payment-headers.js";

const OPTIONS = { price: "0.05", currency: "USD", apiKey: "sk_live_test", baseUrl: SOLVERR_URL } satisfies PaywallOptions;
const CLAIM_MS = 300_000;

/** A store that records each call, marks renewals and releases that name another owner than the claim returned, and keeps claims in memory. */
class RecordingStore implements ClaimStore {
  readonly calls: string[] = [];
  private readonly claims = new MemoryClaimStore();
  private readonly owners = new Map<string, string>();

  async claim(key: string, ttlMs: number): Promise<string | null> {
    this.calls.push(`claim ${key} ${ttlMs}`);
    const owner = await this.claims.claim(key, ttlMs);
    if (owner !== null) this.owners.set(key, owner);
    return owner;
  }

  async renew(key: string, owner: string, ttlMs: number): Promise<void> {
    this.calls.push(`renew ${key} ${ttlMs}${this.stranger(key, owner)}`);
    await this.claims.renew(key, owner, ttlMs);
  }

  async release(key: string, owner: string): Promise<void> {
    this.calls.push(`release ${key}${this.stranger(key, owner)}`);
    await this.claims.release(key, owner);
  }

  private stranger(key: string, owner: string): string {
    return this.owners.get(key) === owner ? "" : " by another owner";
  }

  count(operation: string): number {
    return this.calls.filter((call) => call.startsWith(`${operation} `)).length;
  }
}

/** A handler that counts its runs and answers `status` once `open` is called. */
function gatedHandler(status = 200) {
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const handler = Object.assign(
    async () => {
      handler.runs += 1;
      await gate;
      return Response.json({ data: "premium" }, { status });
    },
    { runs: 0, open: () => open() },
  );
  return handler;
}

function countingHandler(status = 200) {
  const handler = Object.assign(
    async () => {
      handler.runs += 1;
      return Response.json({ data: "premium" }, { status });
    },
    { runs: 0 },
  );
  return handler;
}

function premiumRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://api.example.test/premium", { headers });
}

/** Sends Solverr API calls that `fails` matches to `reply` instead of the fake API; `reply` may throw, as an unreachable host does. */
function failSolverr(fails: (path: string, method: string) => boolean, reply: () => Response) {
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin === SOLVERR_URL && fails(url.pathname, init?.method ?? "GET")) return reply();
    return api.fetch(input, init);
  });
}

const keyRejected = () => Response.json({ error: { type: "authentication_error", message: "Invalid API key." } }, { status: 401 });
const unreachable = (): Response => {
  throw new TypeError("fetch failed");
};

function header(response: Response, name: string): string {
  const value = response.headers.get(name);
  if (value === null) throw new Error(`The response has no ${name} header.`);
  return value;
}

const paymentRequired = (response: Response): PaymentRequired => decodePaymentRequiredHeader(header(response, "PAYMENT-REQUIRED"));
const paymentResponse = (response: Response): SettleResponse => decodePaymentResponseHeader(header(response, "PAYMENT-RESPONSE"));

let api: FakeApi;

beforeEach(() => {
  api = new FakeApi();
  vi.stubGlobal("fetch", api.fetch);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("solverr invoice payments", () => {
  it("answers an unpaid request with 402 and a new invoice for the resource", async () => {
    const handler = countingHandler();
    const response = await paywall({ ...OPTIONS, claimStore: new MemoryClaimStore() }, handler)(premiumRequest());
    expect(response.status).toBe(402);
    const required = paymentRequired(response);
    expect(required.accepts[0]).toMatchObject({ scheme: "solverr", payTo: "inv_challenge_1", amount: "50000", network: "eip155:8453" });
    expect(handler.runs).toBe(0);
  });

  it("serves a paid invoice once, redeems it after the handler, and refuses a replay", async () => {
    api.addPaidInvoice("inv_paid");
    const store = new RecordingStore();
    const handler = countingHandler();
    const route = paywall({ ...OPTIONS, claimStore: store }, handler);

    const response = await route(premiumRequest(invoicePayment("inv_paid")));
    expect(response.status).toBe(200);
    expect(paymentResponse(response)).toMatchObject({ success: true, transaction: "0xdelivery", network: "eip155:8453", payer: "0xrefund" });
    expect(store.calls).toEqual([`claim invoice:inv_paid ${CLAIM_MS}`, `renew invoice:inv_paid ${CLAIM_MS}`]);

    const replay = await route(premiumRequest(invoicePayment("inv_paid")));
    expect(replay.status).toBe(402);
    expect(paymentRequired(replay).error).toBe("This payment was already used.");
    expect(handler.runs).toBe(1);
    expect(api.count("redeem")).toBe(1);
  });

  it("refuses an invoice issued for another resource", async () => {
    api.addPaidInvoice("inv_other", { metadata: { solverr_resource: "GET /other" } });
    const handler = countingHandler();
    const response = await paywall({ ...OPTIONS, claimStore: new MemoryClaimStore() }, handler)(premiumRequest(invoicePayment("inv_other")));
    expect(response.status).toBe(402);
    expect(paymentResponse(response)).toMatchObject({ success: false, errorReason: "invalid_payment_requirements" });
    expect(handler.runs).toBe(0);
  });

  it.each([
    { refused: "an unpaid invoice", changes: { status: "awaiting_payment" }, errorReason: "invalid_transaction_state" },
    { refused: "an invoice for another amount", changes: { amount: "0.01" }, errorReason: "invalid_payment_requirements" },
    { refused: "an invoice in another currency", changes: { currency: "EUR" }, errorReason: "invalid_payment_requirements" },
  ])("refuses $refused without running the handler or using the payment", async ({ changes, errorReason }) => {
    api.addPaidInvoice("inv_refused", changes);
    const store = new RecordingStore();
    const handler = countingHandler();
    const response = await paywall({ ...OPTIONS, claimStore: store }, handler)(premiumRequest(invoicePayment("inv_refused")));
    expect(response.status).toBe(402);
    expect(paymentResponse(response)).toMatchObject({ success: false, errorReason });
    expect(handler.runs).toBe(0);
    expect(store.calls).toEqual([]);
    expect(api.count("redeem")).toBe(0);
    expect(api.count("verify")).toBe(0);
  });

  it("answers 400 to a signature that is not base64 JSON", async () => {
    const response = await paywall({ ...OPTIONS, claimStore: new MemoryClaimStore() }, countingHandler())(premiumRequest({ "PAYMENT-SIGNATURE": "%%%" }));
    expect(response.status).toBe(400);
  });

  it("releases the claim without redeeming when the handler answers 400 or higher", async () => {
    api.addPaidInvoice("inv_failing");
    const store = new RecordingStore();
    const response = await paywall({ ...OPTIONS, claimStore: store }, countingHandler(500))(premiumRequest(invoicePayment("inv_failing")));
    expect(response.status).toBe(500);
    expect(store.calls).toEqual([`claim invoice:inv_failing ${CLAIM_MS}`, "release invoice:inv_failing"]);
    expect(api.count("redeem")).toBe(0);
    expect(api.invoices.get("inv_failing")?.redeemed_at).toBeNull();

    const retry = await paywall({ ...OPTIONS, claimStore: store }, countingHandler())(premiumRequest(invoicePayment("inv_failing")));
    expect(retry.status).toBe(200);
  });

  it("releases the claim when the handler throws", async () => {
    api.addPaidInvoice("inv_throwing");
    const store = new RecordingStore();
    const route = paywall({ ...OPTIONS, claimStore: store }, async () => {
      throw new Error("handler failed");
    });
    await expect(route(premiumRequest(invoicePayment("inv_throwing")))).rejects.toThrow("handler failed");
    expect(store.calls).toEqual([`claim invoice:inv_throwing ${CLAIM_MS}`, "release invoice:inv_throwing"]);
    expect(api.count("redeem")).toBe(0);
    expect(api.invoices.get("inv_throwing")?.redeemed_at).toBeNull();
  });

  it("redeems the invoice only after the handler answered", async () => {
    api.addPaidInvoice("inv_order");
    const redeemsSeenByHandler: number[] = [];
    const route = paywall({ ...OPTIONS, claimStore: new MemoryClaimStore() }, async () => {
      redeemsSeenByHandler.push(api.count("redeem"));
      return Response.json({ data: "premium" }, { status: 201 });
    });
    const response = await route(premiumRequest(invoicePayment("inv_order")));
    expect(response.status).toBe(201);
    expect(redeemsSeenByHandler).toEqual([0]);
    expect(api.count("redeem")).toBe(1);
    expect(api.invoices.get("inv_order")?.redeemed_at).not.toBeNull();
  });

  it("releases the claim and answers 402 when the redeem is refused", async () => {
    api.addPaidInvoice("inv_raced");
    const store = new RecordingStore();
    const route = paywall({ ...OPTIONS, claimStore: store }, async () => {
      const invoice = api.invoices.get("inv_raced");
      if (invoice) invoice.redeemed_at = new Date().toISOString();
      return Response.json({ data: "premium" });
    });
    const response = await route(premiumRequest(invoicePayment("inv_raced")));
    expect(response.status).toBe(402);
    expect(paymentResponse(response)).toMatchObject({ success: false, errorReason: "invalid_transaction_state" });
    expect(store.calls).toEqual([`claim invoice:inv_raced ${CLAIM_MS}`, "release invoice:inv_raced"]);
  });

  it("keeps a newer request's claim when an older request fails after its own claim expired", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      api.addPaidInvoice("inv_slow");
      const store = new MemoryClaimStore();
      const slow = gatedHandler(500);
      const fast = gatedHandler();
      const older = paywall({ ...OPTIONS, claimStore: store }, slow)(premiumRequest(invoicePayment("inv_slow")));
      await vi.waitFor(() => expect(slow.runs).toBe(1));
      vi.advanceTimersByTime(CLAIM_MS);
      const newer = paywall({ ...OPTIONS, claimStore: store }, fast)(premiumRequest(invoicePayment("inv_slow")));
      await vi.waitFor(() => expect(fast.runs).toBe(1));

      slow.open();
      expect((await older).status).toBe(500);
      const copy = await paywall({ ...OPTIONS, claimStore: store }, countingHandler())(premiumRequest(invoicePayment("inv_slow")));
      expect(paymentRequired(copy).error).toBe("This payment is already being used by another request.");
      fast.open();
      expect((await newer).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shares the default in-memory store between paywalls in one process", async () => {
    api.addPaidInvoice("inv_default_store");
    const handler = gatedHandler();
    const first = paywall(OPTIONS, handler);
    const second = paywall(OPTIONS, handler);
    const responses = Promise.all([first(premiumRequest(invoicePayment("inv_default_store"))), second(premiumRequest(invoicePayment("inv_default_store")))]);
    await vi.waitFor(() => expect(api.count("create")).toBe(1));
    handler.open();
    expect((await responses).map((response) => response.status).sort()).toEqual([200, 402]);
    expect(handler.runs).toBe(1);
  });
});

describe("a payment sent to two instances at once", () => {
  it("runs the handler once when both instances share a claim store", async () => {
    api.addPaidInvoice("inv_shared");
    const store = new RecordingStore();
    const handler = gatedHandler();
    const instanceA = paywall({ ...OPTIONS, claimStore: store }, handler);
    const instanceB = paywall({ ...OPTIONS, claimStore: store }, handler);

    const responses = Promise.all([instanceA(premiumRequest(invoicePayment("inv_shared"))), instanceB(premiumRequest(invoicePayment("inv_shared")))]);
    await vi.waitFor(() => expect(store.count("claim")).toBe(2));
    handler.open();
    const statuses = (await responses).map((response) => response.status).sort();

    expect(statuses).toEqual([200, 402]);
    expect(handler.runs).toBe(1);
    expect(api.count("redeem")).toBe(1);
  });

  it("runs the handler on each instance when every instance keeps its own memory", async () => {
    api.addPaidInvoice("inv_separate");
    const handler = gatedHandler();
    const instanceA = paywall({ ...OPTIONS, claimStore: new MemoryClaimStore() }, handler);
    const instanceB = paywall({ ...OPTIONS, claimStore: new MemoryClaimStore() }, handler);

    const responses = Promise.all([instanceA(premiumRequest(invoicePayment("inv_separate"))), instanceB(premiumRequest(invoicePayment("inv_separate")))]);
    await vi.waitFor(() => expect(handler.runs).toBe(2));
    handler.open();
    const statuses = (await responses).map((response) => response.status).sort();

    expect(statuses).toEqual([200, 402]);
    expect(api.count("redeem")).toBe(2);
  });

  it("runs an exact payment's handler once across instances sharing Redis", async () => {
    const redis = new FakeRedis();
    const handler = gatedHandler();
    const instanceA = paywall({ ...OPTIONS, exact: EXACT, claimStore: new RedisClaimStore(redis.command) }, handler);
    const instanceB = paywall({ ...OPTIONS, exact: EXACT, claimStore: new RedisClaimStore(redis.command) }, handler);

    const responses = Promise.all([instanceA(premiumRequest(exactPayment("0x01"))), instanceB(premiumRequest(exactPayment("0x01")))]);
    await vi.waitFor(() => expect(redis.commands.filter((command) => command.includes("NX"))).toHaveLength(2));
    handler.open();
    const [first, second] = await responses;

    expect([first.status, second.status].sort()).toEqual([200, 402]);
    const refused = first.status === 402 ? first : second;
    expect(paymentResponse(refused)).toMatchObject({ success: false, errorReason: "invalid_transaction_state" });
    expect(handler.runs).toBe(1);
    expect(api.count("settle")).toBe(1);
  });
});

describe("exact payments", () => {
  it("verifies, runs the handler, settles and keeps the claim", async () => {
    const store = new RecordingStore();
    const handler = countingHandler();
    const route = paywall({ ...OPTIONS, exact: EXACT, claimStore: store }, handler);
    const response = await route(premiumRequest(exactPayment("0x02")));

    expect(response.status).toBe(200);
    expect(paymentResponse(response)).toMatchObject({ success: true, transaction: "0xsettled", network: "eip155:8453", payer: "0xpayer" });
    expect(store.calls).toEqual([`claim 0xpayer:0x02 ${CLAIM_MS}`, `renew 0xpayer:0x02 ${CLAIM_MS}`]);
    expect((await route(premiumRequest(exactPayment("0x02")))).status).toBe(402);
    expect(handler.runs).toBe(1);
  });

  it("does not run the handler for a payment the facilitator rejects", async () => {
    api.verifyResult = { isValid: false, invalidReason: "invalid_exact_evm_payload_signature", invalidMessage: "Bad signature." };
    const store = new RecordingStore();
    const handler = countingHandler();
    const response = await paywall({ ...OPTIONS, exact: EXACT, claimStore: store }, handler)(premiumRequest(exactPayment("0x03")));
    expect(response.status).toBe(402);
    expect(paymentResponse(response)).toMatchObject({ errorReason: "invalid_exact_evm_payload_signature" });
    expect(handler.runs).toBe(0);
    expect(store.calls).toEqual([]);
  });

  it("refuses a payment for another price before asking the facilitator", async () => {
    const store = new RecordingStore();
    const handler = countingHandler();
    const cheaper = exactPayment("0x06", exactRequirements("0.01", "USD", EXACT));
    const response = await paywall({ ...OPTIONS, exact: EXACT, claimStore: store }, handler)(premiumRequest(cheaper));
    expect(response.status).toBe(402);
    expect(paymentResponse(response)).toMatchObject({ success: false, errorReason: "invalid_payment_requirements" });
    expect(handler.runs).toBe(0);
    expect(store.calls).toEqual([]);
    expect(api.count("verify")).toBe(0);
    expect(api.count("settle")).toBe(0);
  });

  it("releases the claim when settlement fails before broadcasting", async () => {
    api.settleResult = { success: false, errorReason: "insufficient_funds", transaction: "", network: "eip155:8453" };
    const store = new RecordingStore();
    const response = await paywall({ ...OPTIONS, exact: EXACT, claimStore: store }, countingHandler())(premiumRequest(exactPayment("0x04")));
    expect(response.status).toBe(402);
    expect(store.calls).toEqual([`claim 0xpayer:0x04 ${CLAIM_MS}`, "release 0xpayer:0x04"]);
  });

  it("keeps the claim when a broadcast settlement is not confirmed", async () => {
    api.settleResult = { success: false, errorReason: "transaction_failed", transaction: "0xbroadcast", network: "eip155:8453" };
    const store = new RecordingStore();
    const route = paywall({ ...OPTIONS, exact: EXACT, claimStore: store }, countingHandler());
    expect((await route(premiumRequest(exactPayment("0x05")))).status).toBe(402);
    expect(store.calls).toEqual([`claim 0xpayer:0x05 ${CLAIM_MS}`]);

    const copy = await route(premiumRequest(exactPayment("0x05")));
    expect(paymentRequired(copy).error).toBe("This payment is already being used by another request.");
  });
});

describe("claim store failures", () => {
  it("answers 503 without running the handler when a claim fails", async () => {
    api.addPaidInvoice("inv_store_down");
    const store = new RecordingStore();
    store.claim = async () => {
      throw new Error("connection refused");
    };
    const handler = countingHandler();
    const response = await paywall({ ...OPTIONS, claimStore: store }, handler)(premiumRequest(invoicePayment("inv_store_down")));
    expect(response.status).toBe(503);
    expect(header(response, "Retry-After")).toBe("5");
    expect(handler.runs).toBe(0);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("could not claim a payment: connection refused"));
  });

  it("logs a failed release and still sends the handler's response", async () => {
    api.addPaidInvoice("inv_release_down");
    const store = new RecordingStore();
    store.release = async () => {
      throw new Error("connection reset");
    };
    const response = await paywall({ ...OPTIONS, claimStore: store }, countingHandler(500))(premiumRequest(invoicePayment("inv_release_down")));
    expect(response.status).toBe(500);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("could not release a payment claim"));
  });

  it("logs a failed renewal and still serves the settled payment", async () => {
    api.addPaidInvoice("inv_renew_down");
    const store = new RecordingStore();
    store.renew = async () => {
      throw new Error("connection reset");
    };
    const response = await paywall({ ...OPTIONS, claimStore: store }, countingHandler())(premiumRequest(invoicePayment("inv_renew_down")));
    expect(response.status).toBe(200);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("could not renew a settled payment's claim"));
  });
});

describe("credits and challenge limits", () => {
  const credit = { Authorization: "Bearer solverr_credit_abc" };

  it("keeps a credit charge after a successful handler and reports the balance", async () => {
    const response = await paywall({ ...OPTIONS, credits: true }, countingHandler())(premiumRequest(credit));
    expect(response.status).toBe(200);
    expect(header(response, "Solverr-Credit-Balance")).toBe("4.95");
    expect(api.count("refund")).toBe(0);
  });

  it("charges credits before the handler runs", async () => {
    const chargesSeenByHandler: number[] = [];
    const route = paywall({ ...OPTIONS, credits: true }, async () => {
      chargesSeenByHandler.push(api.count("charge"));
      return Response.json({ data: "premium" });
    });
    expect((await route(premiumRequest(credit))).status).toBe(200);
    expect(chargesSeenByHandler).toEqual([1]);
    expect(api.count("charge")).toBe(1);
  });

  it("refunds a credit charge when the handler answers 400 or higher", async () => {
    const response = await paywall({ ...OPTIONS, credits: true }, countingHandler(500))(premiumRequest(credit));
    expect(response.status).toBe(500);
    expect(response.headers.has("Solverr-Credit-Balance")).toBe(false);
    expect(api.count("refund")).toBe(1);
  });

  it("refunds a credit charge when the handler throws", async () => {
    const route = paywall({ ...OPTIONS, credits: true }, async () => {
      throw new Error("handler failed");
    });
    await expect(route(premiumRequest(credit))).rejects.toThrow("handler failed");
    expect(api.count("charge")).toBe(1);
    expect(api.count("refund")).toBe(1);
  });

  it("logs the charge id when the refund fails", async () => {
    failSolverr((path) => path.endsWith("/refund"), keyRejected);
    const response = await paywall({ ...OPTIONS, credits: true }, countingHandler(500))(premiumRequest(credit));
    expect(response.status).toBe(500);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("credit charge chg_1 was not refunded"));
  });

  it("answers 429 past the per-client challenge limit without creating an invoice", async () => {
    const route = paywall({ ...OPTIONS, challengeLimit: { key: () => "203.0.113.7", perMinute: 1 } }, countingHandler());
    expect((await route(premiumRequest())).status).toBe(402);
    const limited = await route(premiumRequest());
    expect(limited.status).toBe(429);
    expect(api.count("create")).toBe(1);
  });
});

describe("Solverr API failures", () => {
  const misconfigured = { error: { type: "payment_misconfigured", message: "The Solverr API rejected this server's API key." } };

  it("answers 500 and logs Solverr's reason when the key is rejected while creating the challenge invoice", async () => {
    failSolverr((path, method) => path === "/api/v1/invoices" && method === "POST", keyRejected);
    const response = await paywall({ ...OPTIONS, claimStore: new MemoryClaimStore() }, countingHandler())(premiumRequest());
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { type: "payment_misconfigured" } });
    expect(response.headers.has("PAYMENT-REQUIRED")).toBe(false);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("HTTP 401 authentication_error"));
  });

  it("answers 500 without running the handler when the key is rejected while reading the invoice", async () => {
    api.addPaidInvoice("inv_key_read");
    failSolverr((path, method) => path === "/api/v1/invoices/inv_key_read" && method === "GET", keyRejected);
    const handler = countingHandler();
    const response = await paywall({ ...OPTIONS, claimStore: new MemoryClaimStore() }, handler)(premiumRequest(invoicePayment("inv_key_read")));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(misconfigured);
    expect(handler.runs).toBe(0);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("answers 500 instead of the handler's response and frees the claim when the key is rejected while redeeming", async () => {
    api.addPaidInvoice("inv_key_redeem");
    failSolverr((path) => path.endsWith("/redeem"), keyRejected);
    const store = new RecordingStore();
    const handler = countingHandler();
    const response = await paywall({ ...OPTIONS, claimStore: store }, handler)(premiumRequest(invoicePayment("inv_key_redeem")));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(misconfigured);
    expect(handler.runs).toBe(1);
    expect(store.calls).toEqual([`claim invoice:inv_key_redeem ${CLAIM_MS}`, "release invoice:inv_key_redeem"]);
    expect(api.invoices.get("inv_key_redeem")?.redeemed_at).toBeNull();
  });

  it("answers 500 without running the handler when the key is rejected while charging credits", async () => {
    failSolverr((path) => path === "/api/v1/credits/charge", keyRejected);
    const handler = countingHandler();
    const response = await paywall({ ...OPTIONS, credits: true }, handler)(premiumRequest({ Authorization: "Bearer solverr_credit_abc" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(misconfigured);
    expect(handler.runs).toBe(0);
  });

  it("answers 503 with Retry-After when Solverr cannot be reached for a challenge", async () => {
    failSolverr(() => true, unreachable);
    const handler = countingHandler();
    const response = await paywall({ ...OPTIONS, claimStore: new MemoryClaimStore() }, handler)(premiumRequest());
    expect(response.status).toBe(503);
    expect(header(response, "Retry-After")).toBe("5");
    expect(await response.json()).toMatchObject({ error: { type: "payment_unavailable" } });
    expect(handler.runs).toBe(0);
  });

  it("answers 503 instead of the handler's response and leaves the invoice unused when the redeem cannot reach Solverr", async () => {
    api.addPaidInvoice("inv_redeem_down");
    failSolverr((path) => path.endsWith("/redeem"), unreachable);
    const store = new RecordingStore();
    const response = await paywall({ ...OPTIONS, claimStore: store }, countingHandler())(premiumRequest(invoicePayment("inv_redeem_down")));
    expect(response.status).toBe(503);
    expect(header(response, "Retry-After")).toBe("5");
    expect(store.calls).toEqual([`claim invoice:inv_redeem_down ${CLAIM_MS}`, "release invoice:inv_redeem_down"]);
    expect(api.invoices.get("inv_redeem_down")?.redeemed_at).toBeNull();
  });
});
