import { createServer, request, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryClaimStore } from "../src/claim-store.js";
import { expressHandler, paywallExpress } from "../src/express.js";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "../src/index.js";
import type { PaywallOptions } from "../src/paywall.js";
import { FakeApi, SOLVERR_URL } from "./fake-api.js";
import { EXACT, exactPayment, invoicePayment } from "./payment-headers.js";

const OPTIONS = { price: "0.05", currency: "USD", apiKey: "sk_live_test", baseUrl: SOLVERR_URL } satisfies PaywallOptions;
const EXPOSED = "PAYMENT-REQUIRED, PAYMENT-RESPONSE, Solverr-Credit-Balance";
const CREDIT = { Authorization: "Bearer solverr_credit_abc" };

type Middleware = ReturnType<typeof paywallExpress>;
type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

interface Reply {
  status: number;
  statusMessage: string;
  headers: IncomingHttpHeaders;
  body: string;
}

let api: FakeApi;
const servers: Server[] = [];
/** Errors that reached the app through `next(error)` or a throwing route handler; the app answers them with 500 like Express's final handler. */
let routeErrors: unknown[];

/** Serves every path through `middleware` and then `handler` on 127.0.0.1, chained as Express chains them, and returns the server's origin. */
async function serve(middleware: Middleware, handler: RouteHandler = () => undefined): Promise<string> {
  const server = createServer((req, res) => {
    const fail = (error: unknown) => {
      routeErrors.push(error);
      res.statusCode = 500;
      res.end("Internal Server Error");
    };
    middleware(req, res, (error) => {
      if (error !== undefined) return fail(error);
      try {
        Promise.resolve(handler(req, res)).catch(fail);
      } catch (thrown) {
        fail(thrown);
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Sends GET `path` with node:http, which keeps the status message and each Set-Cookie value. */
function get(origin: string, headers: Record<string, string> = {}, path = "/premium"): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const outgoing = request(`${origin}${path}`, { headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode ?? 0, statusMessage: res.statusMessage ?? "", headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

function header(reply: Reply, name: string): string {
  const value = reply.headers[name.toLowerCase()];
  if (typeof value !== "string") throw new Error(`The response has no single ${name} header.`);
  return value;
}

const paymentResponse = (reply: Reply) => decodePaymentResponseHeader(header(reply, "PAYMENT-RESPONSE"));

beforeEach(() => {
  api = new FakeApi();
  routeErrors = [];
  vi.stubGlobal("fetch", api.fetch);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

describe("paywallExpress with solverr invoices", () => {
  it("answers an unpaid request with the 402 challenge and never calls the route handler", async () => {
    const handler = vi.fn();
    const reply = await get(await serve(paywallExpress({ ...OPTIONS, claimStore: new MemoryClaimStore() }), handler));

    expect(reply.status).toBe(402);
    expect(reply.statusMessage).toBe("Payment Required");
    expect(reply.headers).toMatchObject({ "content-type": "application/json", "cache-control": "no-store", "access-control-expose-headers": EXPOSED });
    expect(decodePaymentRequiredHeader(header(reply, "PAYMENT-REQUIRED")).accepts[0]).toMatchObject({ scheme: "solverr", payTo: "inv_challenge_1" });
    expect(JSON.parse(reply.body)).toMatchObject({ x402Version: 2, accepts: [{ scheme: "solverr", payTo: "inv_challenge_1" }] });
    expect(handler).not.toHaveBeenCalled();
  });

  it("sends the handler's status message, header list with both cookies and body, and redeems only after the handler", async () => {
    api.addPaidInvoice("inv_express");
    const redeemsSeenByHandler: number[] = [];
    const origin = await serve(paywallExpress({ ...OPTIONS, claimStore: new MemoryClaimStore() }), (_req, res) => {
      redeemsSeenByHandler.push(api.count("redeem"));
      res.setHeader("Access-Control-Expose-Headers", "X-Request-Id, payment-response");
      res.writeHead(201, "Made For You", ["Set-Cookie", "session=1; HttpOnly", "Content-Type", "application/json", "set-cookie", "theme=dark"]);
      res.write('{"data":');
      res.write("227072656d69756d22", "hex");
      res.end("}");
    });
    const reply = await get(origin, invoicePayment("inv_express"));

    expect(reply.status).toBe(201);
    expect(reply.statusMessage).toBe("Made For You");
    expect(reply.headers["set-cookie"]).toEqual(["session=1; HttpOnly", "theme=dark"]);
    expect(header(reply, "Content-Type")).toBe("application/json");
    expect(reply.body).toBe('{"data":"premium"}');
    expect(header(reply, "Access-Control-Expose-Headers")).toBe("X-Request-Id, payment-response, PAYMENT-REQUIRED, Solverr-Credit-Balance");
    expect(paymentResponse(reply)).toMatchObject({ success: true, transaction: "0xdelivery", network: "eip155:8453", payer: "0xrefund" });
    expect(redeemsSeenByHandler).toEqual([0]);
    expect(api.count("redeem")).toBe(1);
  });

  it("takes writeHead headers as an object with a cookie list, keeps Node's default status message and calls the end callback", async () => {
    api.addPaidInvoice("inv_object_headers");
    const ended = vi.fn();
    const origin = await serve(paywallExpress({ ...OPTIONS, claimStore: new MemoryClaimStore() }), (_req, res) => {
      res.writeHead(200, { "Set-Cookie": ["a=1", "b=2"], "Content-Type": "text/plain" });
      res.end("ok", ended);
    });
    const reply = await get(origin, invoicePayment("inv_object_headers"));

    expect(reply.status).toBe(200);
    expect(reply.statusMessage).toBe("OK");
    expect(reply.headers["set-cookie"]).toEqual(["a=1", "b=2"]);
    expect(reply.body).toBe("ok");
    expect(paymentResponse(reply).success).toBe(true);
    await vi.waitFor(() => expect(ended).toHaveBeenCalledOnce());
  });

  it("throws like Node for a writeHead header list of odd length, and the invoice stays unused", async () => {
    api.addPaidInvoice("inv_odd_list");
    const origin = await serve(paywallExpress({ ...OPTIONS, claimStore: new MemoryClaimStore() }), (_req, res) => {
      res.writeHead(200, ["Set-Cookie", "a=1", "Content-Type"]);
      res.end("never sent");
    });
    const reply = await get(origin, invoicePayment("inv_odd_list"));

    expect(reply.status).toBe(500);
    expect(reply.body).toBe("Internal Server Error");
    expect(routeErrors).toHaveLength(1);
    expect(routeErrors[0]).toBeInstanceOf(TypeError);
    expect((routeErrors[0] as Error).message).toBe("writeHead headers given as a list must alternate names and values.");
    expect(api.count("redeem")).toBe(0);
    expect(api.invoices.get("inv_odd_list")?.redeemed_at).toBeNull();
  });

  it("sends a handler response of 400 or higher with merged paywall headers, without redeeming, and frees the payment for a retry", async () => {
    api.addPaidInvoice("inv_not_found");
    let status = 404;
    const origin = await serve(paywallExpress({ ...OPTIONS, claimStore: new MemoryClaimStore() }), (_req, res) => {
      res.setHeader("Access-Control-Expose-Headers", "X-Trace");
      res.writeHead(status, status >= 400 ? "Nothing Here" : "Found", { "Content-Type": "text/plain", "Set-Cookie": ["a=1", "b=2"] });
      res.end(status >= 400 ? "missing" : "premium");
    });

    const failed = await get(origin, invoicePayment("inv_not_found"));
    expect(failed.status).toBe(404);
    expect(failed.statusMessage).toBe("Nothing Here");
    expect(failed.body).toBe("missing");
    expect(failed.headers["set-cookie"]).toEqual(["a=1", "b=2"]);
    expect(header(failed, "Access-Control-Expose-Headers")).toBe(`X-Trace, ${EXPOSED}`);
    expect(failed.headers["payment-response"]).toBeUndefined();
    expect(api.count("redeem")).toBe(0);
    expect(api.invoices.get("inv_not_found")?.redeemed_at).toBeNull();

    status = 200;
    const retry = await get(origin, invoicePayment("inv_not_found"));
    expect(retry.status).toBe(200);
    expect(retry.body).toBe("premium");
    expect(paymentResponse(retry).success).toBe(true);
    expect(api.count("redeem")).toBe(1);
  });

  it("passes a throwing handler's error on without redeeming, and frees the payment for a retry", async () => {
    api.addPaidInvoice("inv_handler_throws");
    let throws = true;
    const origin = await serve(paywallExpress({ ...OPTIONS, claimStore: new MemoryClaimStore() }), (_req, res) => {
      if (throws) throw new Error("database down");
      res.end("premium");
    });

    const failed = await get(origin, invoicePayment("inv_handler_throws"));
    expect(failed.status).toBe(500);
    expect((routeErrors[0] as Error).message).toBe("database down");
    expect(header(failed, "Access-Control-Expose-Headers")).toBe(EXPOSED);
    expect(api.count("redeem")).toBe(0);
    expect(api.invoices.get("inv_handler_throws")?.redeemed_at).toBeNull();

    throws = false;
    expect((await get(origin, invoicePayment("inv_handler_throws"))).status).toBe(200);
    expect(api.count("redeem")).toBe(1);
  });

  it("replaces the held response, its status message and its headers with the 402 rejection when the redeem is refused", async () => {
    api.addPaidInvoice("inv_redeemed_meanwhile");
    const origin = await serve(paywallExpress({ ...OPTIONS, claimStore: new MemoryClaimStore() }), (_req, res) => {
      const invoice = api.invoices.get("inv_redeemed_meanwhile");
      if (invoice) invoice.redeemed_at = new Date().toISOString();
      res.writeHead(200, "Fresh", ["Set-Cookie", "session=1", "X-Handler", "yes"]);
      res.end("premium");
    });
    const reply = await get(origin, invoicePayment("inv_redeemed_meanwhile"));

    expect(reply.status).toBe(402);
    expect(reply.statusMessage).toBe("Payment Required");
    expect(reply.headers["set-cookie"]).toBeUndefined();
    expect(reply.headers["x-handler"]).toBeUndefined();
    expect(header(reply, "Content-Type")).toBe("application/json");
    expect(paymentResponse(reply)).toMatchObject({ success: false, errorReason: "invalid_transaction_state" });
    expect(JSON.parse(reply.body)).toMatchObject({ x402Version: 2, accepts: [{ scheme: "solverr" }] });
    expect(api.count("redeem")).toBe(1);
  });

  it("keeps headers set before the paywall, such as CORS, on the 402 rejection, and drops the handler's", async () => {
    api.addPaidInvoice("inv_redeemed_meanwhile");
    const gate = paywallExpress({ ...OPTIONS, claimStore: new MemoryClaimStore() });
    const withCors: Middleware = (req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "https://app.example");
      gate(req, res, next);
    };
    const origin = await serve(withCors, (_req, res) => {
      const invoice = api.invoices.get("inv_redeemed_meanwhile");
      if (invoice) invoice.redeemed_at = new Date().toISOString();
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("X-Handler", "yes");
      res.end("premium");
    });
    const reply = await get(origin, invoicePayment("inv_redeemed_meanwhile"));

    expect(reply.status).toBe(402);
    expect(header(reply, "Access-Control-Allow-Origin")).toBe("https://app.example");
    expect(reply.headers["x-handler"]).toBeUndefined();
    expect(header(reply, "Content-Type")).toBe("application/json");
  });

  it("answers 503 with Retry-After when Solverr cannot be reached", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const handler = vi.fn();
    const reply = await get(await serve(paywallExpress({ ...OPTIONS, claimStore: new MemoryClaimStore() }), handler));

    expect(reply.status).toBe(503);
    expect(reply.statusMessage).toBe("Service Unavailable");
    expect(header(reply, "Retry-After")).toBe("5");
    expect(JSON.parse(reply.body)).toMatchObject({ error: { type: "payment_unavailable" } });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("paywallExpress with credits", () => {
  it("charges before the handler and reports the balance once the handler succeeded", async () => {
    const chargesSeenByHandler: number[] = [];
    const origin = await serve(paywallExpress({ ...OPTIONS, credits: true }), (_req, res) => {
      chargesSeenByHandler.push(api.count("charge"));
      res.end("premium");
    });
    const reply = await get(origin, CREDIT);

    expect(reply.status).toBe(200);
    expect(reply.body).toBe("premium");
    expect(header(reply, "Solverr-Credit-Balance")).toBe("4.95");
    expect(chargesSeenByHandler).toEqual([1]);
    expect(api.count("refund")).toBe(0);
  });

  it("refunds the charge when the handler answers 400 or higher", async () => {
    const origin = await serve(paywallExpress({ ...OPTIONS, credits: true }), (_req, res) => {
      res.statusCode = 503;
      res.end("busy");
    });
    const reply = await get(origin, CREDIT);

    expect(reply.status).toBe(503);
    expect(reply.statusMessage).toBe("Service Unavailable");
    expect(reply.body).toBe("busy");
    expect(reply.headers["solverr-credit-balance"]).toBeUndefined();
    await vi.waitFor(() => expect(api.count("refund")).toBe(1));
  });

  it("refunds the charge when the handler throws", async () => {
    const origin = await serve(paywallExpress({ ...OPTIONS, credits: true }), () => {
      throw new Error("database down");
    });
    const reply = await get(origin, CREDIT);

    expect(reply.status).toBe(500);
    expect(reply.headers["solverr-credit-balance"]).toBeUndefined();
    await vi.waitFor(() => expect(api.count("refund")).toBe(1));
    expect(api.count("charge")).toBe(1);
  });
});

describe("paywallExpress with exact payments", () => {
  it("settles only after the handler succeeded and adds PAYMENT-RESPONSE", async () => {
    const settlesSeenByHandler: number[] = [];
    const origin = await serve(paywallExpress({ ...OPTIONS, exact: EXACT, claimStore: new MemoryClaimStore() }), (_req, res) => {
      settlesSeenByHandler.push(api.count("settle"));
      res.end("premium");
    });
    const reply = await get(origin, exactPayment("0x10"));

    expect(reply.status).toBe(200);
    expect(reply.body).toBe("premium");
    expect(paymentResponse(reply)).toMatchObject({ success: true, transaction: "0xsettled", network: "eip155:8453", payer: "0xpayer" });
    expect(settlesSeenByHandler).toEqual([0]);
    expect(api.count("verify")).toBe(1);
    expect(api.count("settle")).toBe(1);
  });

  it("does not settle when the handler answers 400 or higher", async () => {
    const origin = await serve(paywallExpress({ ...OPTIONS, exact: EXACT, claimStore: new MemoryClaimStore() }), (_req, res) => {
      res.statusCode = 422;
      res.end("bad input");
    });
    const reply = await get(origin, exactPayment("0x11"));

    expect(reply.status).toBe(422);
    expect(reply.body).toBe("bad input");
    expect(api.count("verify")).toBe(1);
    expect(api.count("settle")).toBe(0);
  });

  it("replaces the handler's response with a 402 when settlement fails", async () => {
    api.settleResult = { success: false, errorReason: "insufficient_funds", transaction: "", network: "eip155:8453" };
    const origin = await serve(paywallExpress({ ...OPTIONS, exact: EXACT, claimStore: new MemoryClaimStore() }), (_req, res) => {
      res.setHeader("Set-Cookie", "session=1");
      res.end("handler output");
    });
    const reply = await get(origin, exactPayment("0x12"));

    expect(reply.status).toBe(402);
    expect(reply.headers["set-cookie"]).toBeUndefined();
    expect(paymentResponse(reply)).toMatchObject({ success: false, errorReason: "insufficient_funds" });
    expect(JSON.parse(reply.body)).toMatchObject({ x402Version: 2, error: "The facilitator could not settle this payment." });
    expect(api.count("settle")).toBe(1);
  });
});

describe("expressHandler", () => {
  it("sends a Web Response's status, status message, headers and body", async () => {
    const handler = expressHandler((request) => new Response(`path ${new URL(request.url).pathname}`, { status: 201, statusText: "Created Here", headers: { "X-Kind": "price-list" } }));
    const reply = await get(await serve(handler), {}, "/.well-known/solverr.json");

    expect(reply.status).toBe(201);
    expect(reply.statusMessage).toBe("Created Here");
    expect(header(reply, "X-Kind")).toBe("price-list");
    expect(reply.body).toBe("path /.well-known/solverr.json");
  });

  it("sends every Set-Cookie value of a Web Response", async () => {
    const headers = new Headers({ "X-Kind": "price-list" });
    headers.append("Set-Cookie", "a=1");
    headers.append("Set-Cookie", "b=2; HttpOnly");
    const reply = await get(await serve(expressHandler(() => new Response("ok", { headers }))), {}, "/.well-known/solverr.json");

    expect(reply.headers["set-cookie"]).toEqual(["a=1", "b=2; HttpOnly"]);
    expect(header(reply, "X-Kind")).toBe("price-list");
  });
});
