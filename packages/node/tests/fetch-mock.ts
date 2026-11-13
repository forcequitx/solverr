import { vi } from "vitest";
import { Solverr } from "../src/client.js";

export const API_KEY = "sk_live_test123";
const BASE_URL = "https://pay.example.com";

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  redirect: RequestInit["redirect"];
  signal: AbortSignal | undefined;
}

type Reply = Response | Error | ((call: RecordedCall) => Response | Promise<Response>);

/** Replaces global `fetch` with a stub that records each call and answers with the queued replies in order. */
export function mockFetch(...replies: Reply[]) {
  const calls: RecordedCall[] = [];
  const fetchStub = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const call: RecordedCall = {
      url: String(input),
      method: init.method ?? "GET",
      headers: { ...(init.headers as Record<string, string>) },
      body: init.body as string | undefined,
      redirect: init.redirect,
      signal: init.signal ?? undefined,
    };
    calls.push(call);
    const reply = replies.length > 1 ? replies.shift() : replies[0];
    if (reply === undefined) throw new Error("No reply queued for this request.");
    if (reply instanceof Error) throw reply;
    return typeof reply === "function" ? reply(call) : reply.clone();
  });
  vi.stubGlobal("fetch", fetchStub);
  return { calls, fetchStub };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function apiError(status: number, type: string, message: string, extra: Record<string, string> = {}, headers: Record<string, string> = {}): Response {
  return json({ error: { type, message, ...extra } }, status, headers);
}

/** A failure the way Node's `fetch` reports one: a TypeError whose cause carries the system error code. */
export function networkError(code = "ECONNREFUSED"): Error {
  return new TypeError("fetch failed", { cause: Object.assign(new Error(`connect ${code}`), { code }) });
}

export function client(baseUrl = BASE_URL): Solverr {
  return new Solverr({ apiKey: API_KEY, baseUrl });
}

/** Calls `run` and returns its promise; an error thrown before the request starts becomes a rejection. */
export async function attempt<T>(run: () => Promise<T>): Promise<T> {
  return run();
}

/** Settles a promise into a value or an error so pending rejections are handled while fake timers run. */
export function settle<T>(promise: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  return promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
}
