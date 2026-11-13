import type { IncomingHttpHeaders } from "node:http";
import { Paywall, UNSETTLED_STATUS, paywallHeaderValue, type PaywallOptions, type PaywallSettlement } from "./paywall.js";

/** The parts of an Express (or plain Node `http`) request the adapter reads. */
export interface NodeRequest {
  method?: string;
  url?: string;
  originalUrl?: string;
  protocol?: string;
  headers: IncomingHttpHeaders;
}

/** The parts of an Express (or plain Node `http`) response the adapter writes or wraps. */
export interface NodeResponse {
  statusCode: number;
  statusMessage: string;
  setHeader(name: string, value: string | readonly string[]): unknown;
  getHeader(name: string): number | string | string[] | undefined;
  removeHeader(name: string): unknown;
  getHeaderNames(): string[];
  writeHead(statusCode: number, ...args: unknown[]): unknown;
  write(chunk: unknown, ...args: unknown[]): boolean;
  end(...args: unknown[]): unknown;
}

export type NextFunction = (error?: unknown) => void;

/** Builds a body-less Web `Request` with the method, absolute URL and headers of a Node request. */
function toWebRequest(req: NodeRequest): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  const protocol = req.protocol ?? "http";
  const url = new URL(req.originalUrl ?? req.url ?? "/", `${protocol}://${req.headers.host ?? "localhost"}`);
  return new Request(url, { method: req.method ?? "GET", headers });
}

/** Writes a Web `Response` to a Node response; every Set-Cookie value is sent, because `Headers.forEach` yields them one at a time. */
async function sendWebResponse(response: Response, res: NodeResponse): Promise<void> {
  res.statusCode = response.status;
  res.statusMessage = response.statusText;
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") res.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader("Set-Cookie", cookies);
  res.end(new Uint8Array(await response.arrayBuffer()));
}

function toBytes(chunk: unknown, encoding: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk;
  if (typeof chunk === "string") return Buffer.from(chunk, typeof encoding === "string" ? (encoding as BufferEncoding) : "utf8");
  return new Uint8Array();
}

const callbackOf = (args: unknown[]) => args.find((arg): arg is () => void => typeof arg === "function");

/** Sets headers given to `writeHead` as Node's flat `[name, value, name, value]` list; a name listed twice keeps every value. */
function setHeaderList(res: NodeResponse, list: unknown[]): void {
  if (list.length % 2 !== 0) throw new TypeError("writeHead headers given as a list must alternate names and values.");
  const byName = new Map<string, { name: string; values: string[] }>();
  for (let index = 0; index < list.length; index += 2) {
    const name = String(list[index]);
    const entry = byName.get(name.toLowerCase()) ?? { name, values: [] };
    entry.values.push(String(list[index + 1]));
    byName.set(name.toLowerCase(), entry);
  }
  for (const { name, values } of byName.values()) res.setHeader(name, values.length === 1 ? values[0] : values);
}

/** Sets the paywall's headers over the ones a handler set, merged as `paywallHeaderValue` describes. */
function addHeaders(res: NodeResponse, headers: Record<string, string>): void {
  for (const [name, value] of Object.entries(headers)) {
    const existing = res.getHeader(name);
    res.setHeader(name, paywallHeaderValue(name, value, existing === undefined ? null : [existing].flat().join(", ")));
  }
}

/** Holds the status, headers and body the next handlers write until `settle` decides between sending them with `headers` and its rejection (402, 500 or 503).
    A response of 400 or higher is not settled: it is sent with `headers` once `release` has freed the payment for another try. */
function holdUntilSettled(
  res: NodeResponse,
  headers: Record<string, string>,
  settle: () => Promise<PaywallSettlement>,
  release: (() => void | Promise<void>) | undefined,
  next: NextFunction,
): void {
  const { writeHead, write, end } = res;
  const chunks: Uint8Array[] = [];
  /** Headers set before the paywall, such as CORS, stay on a rejection; only the handler's own are dropped. */
  const earlierHeaders = res.getHeaderNames().map((name) => [name, res.getHeader(name)!] as const);

  res.writeHead = (statusCode: number, ...args: unknown[]) => {
    res.statusCode = statusCode;
    if (typeof args[0] === "string") res.statusMessage = args[0];
    const given = args.find((arg) => arg !== null && typeof arg === "object");
    if (Array.isArray(given)) setHeaderList(res, given);
    else for (const [name, value] of Object.entries((given ?? {}) as Record<string, string | string[]>)) res.setHeader(name, value);
    return res;
  };
  res.write = (chunk: unknown, ...args: unknown[]) => {
    chunks.push(toBytes(chunk, args[0]));
    callbackOf(args)?.();
    return true;
  };
  res.end = (...args: unknown[]) => {
    if (args.length > 0 && typeof args[0] !== "function" && args[0] != null) chunks.push(toBytes(args[0], args[1]));
    const callback = callbackOf(args);
    res.writeHead = writeHead;
    res.write = write;
    res.end = end;
    const body = Buffer.concat(chunks);
    if (res.statusCode >= UNSETTLED_STATUS) {
      addHeaders(res, headers);
      /** Awaited so a credit refund finishes before serverless hosts freeze the function after the response. */
      Promise.resolve(release?.())
        .then(() => res.end(body, callback))
        .catch(next);
      return res;
    }
    settle()
      .then(async (settlement) => {
        if (!settlement.success) {
          for (const name of res.getHeaderNames()) res.removeHeader(name);
          for (const [name, value] of earlierHeaders) res.setHeader(name, typeof value === "number" ? String(value) : value);
          return sendWebResponse(settlement.response, res);
        }
        addHeaders(res, { ...headers, ...settlement.headers });
        res.end(body, callback);
      })
      .catch(next);
    return res;
  };
}

/** Express middleware that requires payment before calling `next()`; the handler's response is held until the payment settles
    (credits kept, invoice redeemed, `exact` transfer settled) and replaced by the rejection response if settling fails. */
export function paywallExpress(options: PaywallOptions): (req: NodeRequest, res: NodeResponse, next: NextFunction) => void {
  const gate = new Paywall(options);
  return (req, res, next) => {
    gate
      .authorize(toWebRequest(req))
      .then(async (decision) => {
        if (!decision.granted) return sendWebResponse(decision.response, res);
        if (decision.settle) holdUntilSettled(res, decision.headers, decision.settle, decision.release, next);
        else addHeaders(res, decision.headers);
        next();
      })
      .catch(next);
  };
}

/** Serves a Web-standard handler (such as `priceList(...)`) as an Express route handler. */
export function expressHandler(handler: (request: Request) => Response | Promise<Response>): (req: NodeRequest, res: NodeResponse, next: NextFunction) => void {
  return (req, res, next) => {
    Promise.resolve(handler(toWebRequest(req)))
      .then((response) => sendWebResponse(response, res))
      .catch(next);
  };
}
