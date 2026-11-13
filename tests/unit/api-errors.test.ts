import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError, errorResponse, handleRoute, parseInput, toApiError } from "@/lib/api/errors";
import { API_KEY_PATTERN, hashApiKey } from "@/lib/api/keys";
import { OneClickError } from "@/lib/oneclick/client";

/** The shape the Prisma pg adapter gives a query that Postgres refused with `code`. */
const postgresRefusal = (code: string) => Object.assign(new Error("Invalid query"), { meta: { driverAdapterError: { cause: { code } } } });

describe("toApiError", () => {
  it("keeps an ApiError as it is", () => {
    const error = new ApiError(404, "not_found", "No invoice with this id.", "id");
    expect(toApiError(error)).toBe(error);
  });

  it("turns text Postgres cannot store into a 400 caused by the request", () => {
    for (const code of ["22021", "22P05"]) {
      expect(toApiError(postgresRefusal(code))).toMatchObject({ status: 400, type: "invalid_request" });
    }
  });

  it("turns a 1Click failure into a 502", () => {
    expect(toApiError(new OneClickError("1Click answered 503", 503))).toMatchObject({ status: 502, type: "upstream_unavailable" });
  });

  it("hides any other error behind a generic 500", () => {
    const apiError = toApiError(new Error("connection string postgres://user:secret@db/solverr"));
    expect(apiError).toMatchObject({ status: 500, type: "internal_error", message: "Something went wrong. Try again shortly." });
    expect(toApiError(postgresRefusal("23505"))).toMatchObject({ status: 500 });
    expect(toApiError("thrown text")).toMatchObject({ status: 500 });
  });
});

describe("errorResponse", () => {
  it("writes the error body with its type, code and param", async () => {
    const response = errorResponse(new ApiError(409, "invalid_state", "This invoice is already paid.", undefined, undefined, "invoice_paid"));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { type: "invalid_state", code: "invoice_paid", message: "This invoice is already paid." } });
  });

  it("names the Bearer scheme on a 401", () => {
    const response = errorResponse(new ApiError(401, "authentication_failed", "Invalid API key."));
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
  });

  it("sends Retry-After when the error carries one", () => {
    const response = errorResponse(new ApiError(429, "rate_limited", "Too many requests.", undefined, 42));
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(errorResponse(new ApiError(400, "invalid_request", "Bad")).headers.get("Retry-After")).toBeNull();
  });
});

describe("handleRoute", () => {
  it("returns the handler's response, or the JSON error it threw", async () => {
    expect((await handleRoute(async () => Response.json({ ok: true }))).status).toBe(200);
    const failed = await handleRoute(async () => {
      throw new ApiError(404, "not_found", "Missing", "id");
    });
    expect(failed.status).toBe(404);
    expect(await failed.json()).toEqual({ error: { type: "not_found", message: "Missing", param: "id" } });
  });
});

describe("parseInput", () => {
  const schema = z.strictObject({ amount: z.string(), nested: z.object({ value: z.number() }).optional() });

  it("returns the parsed value", () => {
    expect(parseInput(schema, { amount: "1" })).toEqual({ amount: "1" });
  });

  it("names the failing field as param", () => {
    expect(() => parseInput(schema, { amount: 1 })).toThrow(expect.objectContaining({ status: 400, type: "invalid_request", param: "amount" }));
    expect(() => parseInput(schema, { amount: "1", nested: { value: "x" } })).toThrow(expect.objectContaining({ param: "nested.value" }));
  });

  it("names an unknown field as param", () => {
    expect(() => parseInput(schema, { amount: "1", extra: true })).toThrow(expect.objectContaining({ param: "extra" }));
  });
});

describe("API keys", () => {
  it("accepts only sk_live_ with 32 base58 characters", () => {
    expect(API_KEY_PATTERN.test(`sk_live_${"a".repeat(32)}`)).toBe(true);
    expect(API_KEY_PATTERN.test(`sk_test_${"a".repeat(32)}`)).toBe(false);
    expect(API_KEY_PATTERN.test(`sk_live_${"a".repeat(31)}`)).toBe(false);
    expect(API_KEY_PATTERN.test(`sk_live_${"a".repeat(33)}`)).toBe(false);
    for (const excluded of ["0", "O", "I", "l", "_", "-"]) {
      expect(API_KEY_PATTERN.test(`sk_live_${excluded}${"a".repeat(31)}`)).toBe(false);
    }
  });

  it("hashes a key with SHA-256 so only the hash is stored", () => {
    const hash = hashApiKey(`sk_live_${"a".repeat(32)}`);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(`sk_live_${"a".repeat(32)}`)).toBe(hash);
    expect(hashApiKey(`sk_live_${"b".repeat(32)}`)).not.toBe(hash);
    expect(hashApiKey("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
