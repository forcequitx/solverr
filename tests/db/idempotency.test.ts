import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { withIdempotency } from "@/lib/api/idempotency";
import { getDb } from "@/lib/db";
import { createMerchant } from "./factories";

const post = (key?: string, path = "/api/v1/invoices") =>
  new Request(`http://localhost${path}`, { method: "POST", headers: key === undefined ? {} : { "idempotency-key": key } });

const created = (body: Prisma.InputJsonObject = { id: "inv_1", amount: "25.00" }) => vi.fn(async () => ({ status: 201, body }));

/** A handler that stays running until `finish` is called, to hold a key in progress. */
function heldHandler() {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));
  const run = vi.fn(async () => {
    await done;
    return { status: 201, body: { id: "inv_held" } };
  });
  return { run, finish };
}

describe("withIdempotency", () => {
  it("runs every request without an Idempotency-Key", async () => {
    const { id } = await createMerchant();
    const run = created();
    await withIdempotency(post(), id, "{}", run);
    await withIdempotency(post(), id, "{}", run);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("replays the stored response for a retry with the same key and body", async () => {
    const { id } = await createMerchant();
    const run = created();
    const first = await withIdempotency(post("order-42"), id, '{"amount":"25.00"}', run);
    const retry = await withIdempotency(post("order-42"), id, '{"amount":"25.00"}', run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.headers.get("Idempotent-Replayed")).toBe("true");
    expect(await retry.json()).toEqual({ id: "inv_1", amount: "25.00" });
  });

  it("refuses the same key with a different body or path with 409", async () => {
    const { id } = await createMerchant();
    await withIdempotency(post("k1"), id, '{"amount":"25.00"}', created());
    await expect(withIdempotency(post("k1"), id, '{"amount":"26.00"}', created())).rejects.toMatchObject({ status: 409, type: "idempotency_conflict" });
    await expect(withIdempotency(post("k1", "/api/v1/payouts"), id, '{"amount":"25.00"}', created())).rejects.toMatchObject({ status: 409 });
  });

  it("answers 409 with Retry-After while the first request with the key is still running", async () => {
    const { id } = await createMerchant();
    const held = heldHandler();
    const first = withIdempotency(post("k-held"), id, "{}", held.run);
    await vi.waitFor(async () => expect(await getDb().idempotencyRecord.count()).toBe(1));

    const concurrent = created();
    await expect(withIdempotency(post("k-held"), id, "{}", concurrent)).rejects.toMatchObject({ status: 409, retryAfter: 1, message: expect.stringContaining("still being processed") });
    expect(concurrent).not.toHaveBeenCalled();

    held.finish();
    expect((await first).status).toBe(201);
    const replay = await withIdempotency(post("k-held"), id, "{}", concurrent);
    expect(await replay.json()).toEqual({ id: "inv_held" });
    expect(concurrent).not.toHaveBeenCalled();
  });

  it("lets only one of two simultaneous first requests run", async () => {
    const { id } = await createMerchant();
    const run = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { status: 201, body: { id: "inv_once" } };
    });
    const results = await Promise.allSettled([withIdempotency(post("k-race"), id, "{}", run), withIdempotency(post("k-race"), id, "{}", run)]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { status: 409 } });
  });

  it("releases the key when the handler fails or answers 5xx, so a retry runs again", async () => {
    const { id } = await createMerchant();
    await expect(withIdempotency(post("k-err"), id, "{}", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    const unavailable = await withIdempotency(post("k-err"), id, "{}", async () => ({ status: 502, body: { error: "upstream" } }));
    expect(unavailable.status).toBe(502);
    const retry = created();
    expect((await withIdempotency(post("k-err"), id, "{}", retry)).status).toBe(201);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("keeps the handler's own error and answer when the key cannot be released", async () => {
    const { id } = await createMerchant();
    const records = getDb().idempotencyRecord;
    vi.spyOn(records, "deleteMany").mockRejectedValue(new Error("connection reset"));
    const failure = new Error("The payment network is not responding.");

    await expect(withIdempotency(post("order-7"), id, "{}", vi.fn(async () => Promise.reject(failure)))).rejects.toBe(failure);
    const answered = await withIdempotency(post("order-8"), id, "{}", vi.fn(async () => ({ status: 502, body: { error: "upstream" } })));
    expect(answered.status).toBe(502);
  });

  it("replays a 4xx answer too", async () => {
    const { id } = await createMerchant();
    await withIdempotency(post("k-400"), id, "{}", async () => ({ status: 400, body: { error: "bad" } }));
    const run = created();
    expect((await withIdempotency(post("k-400"), id, "{}", run)).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it("scopes keys to the business", async () => {
    const first = await createMerchant();
    const second = await createMerchant();
    await withIdempotency(post("shared-key"), first.id, "{}", created());
    const run = created();
    await withIdempotency(post("shared-key"), second.id, '{"other":true}', run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("stores the response encrypted, never as plain JSON", async () => {
    const { id } = await createMerchant();
    await withIdempotency(post("k-secret"), id, "{}", created({ token: "cr_spendable_token" }));
    const record = await getDb().idempotencyRecord.findFirstOrThrow({ where: { merchantId: id, key: "k-secret" } });
    expect(record.statusCode).toBe(201);
    expect(JSON.stringify(record.responseBody)).not.toContain("cr_spendable_token");
    expect(record.responseBody).toEqual({ ciphertext: expect.stringMatching(/^v1\./) });
  });

  it("runs again once the stored response is older than 24 hours", async () => {
    const { id } = await createMerchant();
    await withIdempotency(post("k-old"), id, "{}", created());
    await getDb().idempotencyRecord.updateMany({ where: { key: "k-old" }, data: { createdAt: new Date(Date.now() - 25 * 60 * 60_000) } });
    const run = created();
    await withIdempotency(post("k-old"), id, '{"new":1}', run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("refuses an empty or over-long key", async () => {
    const { id } = await createMerchant();
    await expect(withIdempotency(post(""), id, "{}", created())).rejects.toMatchObject({ status: 400, param: "Idempotency-Key" });
    await expect(withIdempotency(post("k".repeat(256)), id, "{}", created())).rejects.toMatchObject({ status: 400 });
  });
});
