import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { createApiKey, hashApiKey } from "@/lib/api/keys";
import { pruneRateLimits, rateLimit } from "@/lib/api/rate-limit";
import { getDb } from "@/lib/db";
import { createMerchant } from "./factories";

/** The ApiError `run` rejects with, or a failure when it resolves. */
async function rejection(run: Promise<unknown>): Promise<ApiError> {
  const error = await run.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof ApiError)) throw new Error(`Expected an ApiError, got ${String(error)}`);
  return error;
}

describe("rateLimit", () => {
  it("allows requests up to the limit and refuses the next with 429 and Retry-After", async () => {
    for (let count = 0; count < 3; count++) await rateLimit("ip:203.0.113.5", 3, 60_000);
    const error = await rejection(rateLimit("ip:203.0.113.5", 3, 60_000));
    expect(error).toMatchObject({ status: 429, type: "rate_limited" });
    expect(error.retryAfter).toBeGreaterThanOrEqual(59);
    expect(error.retryAfter).toBeLessThanOrEqual(60);
    expect(error.message).toMatch(/^Too many requests\. Try again in (59 seconds|1 minute)\.$/);
  });

  it("counts each key on its own", async () => {
    await rateLimit("ip:a", 1, 60_000);
    await rateLimit("ip:b", 1, 60_000);
    await expect(rateLimit("ip:a", 1, 60_000)).rejects.toBeInstanceOf(ApiError);
  });

  it("counts a call's cost", async () => {
    await rateLimit("quote-merchant:m1", 10, 60_000, 6);
    await expect(rateLimit("quote-merchant:m1", 10, 60_000, 5)).rejects.toMatchObject({ status: 429 });
  });

  it("starts a new window once the old one ended", async () => {
    await rateLimit("ip:window", 1, 60_000);
    await expect(rateLimit("ip:window", 1, 60_000)).rejects.toMatchObject({ status: 429 });
    /** A minute back, since the window is judged by the database clock, which can run seconds behind this machine's (Docker Desktop). */
    await getDb().requestWindow.update({ where: { key: "ip:window" }, data: { windowEnd: new Date(Date.now() - 60_000) } });

    await rateLimit("ip:window", 1, 60_000);
    const row = await getDb().requestWindow.findUniqueOrThrow({ where: { key: "ip:window" } });
    expect(row.count).toBe(1);
    expect(row.windowEnd.getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  it("asks for at least one second even when the window is about to end", async () => {
    await rateLimit("ip:ending", 1, 60_000);
    await getDb().$executeRaw`UPDATE rate_limit_windows SET window_end = now() + interval '800 milliseconds' WHERE key = 'ip:ending'`;
    expect((await rejection(rateLimit("ip:ending", 1, 60_000))).retryAfter).toBe(1);
  });

  it("stores keys longer than 200 characters as their SHA-256", async () => {
    const longKey = `link:${"x".repeat(300)}`;
    await rateLimit(longKey, 5, 60_000);
    await rateLimit("y".repeat(200), 5, 60_000);
    const keys = (await getDb().requestWindow.findMany({ select: { key: true } })).map((row) => row.key).sort();
    expect(keys).toEqual([`sha256:${createHash("sha256").update(longKey).digest("hex")}`, "y".repeat(200)].sort());
  });

  it("counts concurrent calls together, as separate web instances would", async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => rateLimit("ip:burst", 4, 60_000)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(4);
  });

  it("prunes ended windows only", async () => {
    await rateLimit("ip:old", 5, 60_000);
    await rateLimit("ip:current", 5, 60_000);
    await getDb().requestWindow.update({ where: { key: "ip:old" }, data: { windowEnd: new Date(Date.now() - 1_000) } });
    expect(await pruneRateLimits()).toBe(1);
    expect((await getDb().requestWindow.findMany()).map((row) => row.key)).toEqual(["ip:current"]);
  });
});

describe("createApiKey", () => {
  it("stores only the hash and the last four characters of a new live key", async () => {
    const merchant = await createMerchant();
    const { id, secret } = await createApiKey(merchant.id);
    expect(secret).toMatch(/^sk_live_[1-9A-HJ-NP-Za-km-z]{32}$/);
    const row = await getDb().apiKey.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ keyHash: hashApiKey(secret), last4: secret.slice(-4), merchantId: merchant.id });
    expect(JSON.stringify(row)).not.toContain(secret);
  });
});
