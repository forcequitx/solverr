import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimKeyDigest, MemoryClaimStore, type ClaimStore } from "../src/claim-store.js";
import { PostgresClaimStore } from "../src/postgres-claim-store.js";
import { RedisClaimStore } from "../src/redis-claim-store.js";
import { FakePostgres, FakeRedis } from "./fakes.js";

const TTL_MS = 1000;

/** The rules every store must follow, run against each implementation below. */
function describeClaimStore(name: string, createStores: () => [ClaimStore, ClaimStore]) {
  describe(name, () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-10T00:00:00Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("lets only the first caller claim a key and gives it an owner token", async () => {
      const [store] = createStores();
      const owner = await store.claim("payment-a", TTL_MS);
      expect(owner).toEqual(expect.any(String));
      expect(await store.claim("payment-a", TTL_MS)).toBeNull();
      const other = await store.claim("payment-b", TTL_MS);
      expect(other).toEqual(expect.any(String));
      expect(other).not.toBe(owner);
    });

    it("gives a key to exactly one of many concurrent claims across store instances", async () => {
      const [first, second] = createStores();
      const results = await Promise.all(Array.from({ length: 10 }, (_, index) => (index % 2 ? first : second).claim("payment-a", TTL_MS)));
      expect(results.filter((owner) => owner !== null)).toHaveLength(1);
    });

    it("frees a key once its time runs out", async () => {
      const [store] = createStores();
      expect(await store.claim("payment-a", TTL_MS)).not.toBeNull();
      vi.advanceTimersByTime(TTL_MS - 1);
      expect(await store.claim("payment-a", TTL_MS)).toBeNull();
      vi.advanceTimersByTime(1);
      expect(await store.claim("payment-a", TTL_MS)).not.toBeNull();
    });

    it("frees a key when its owner releases it, for every store instance", async () => {
      const [first, second] = createStores();
      const owner = await held(first.claim("payment-a", TTL_MS));
      await first.release("payment-a", owner);
      expect(await second.claim("payment-a", TTL_MS)).not.toBeNull();
    });

    it("keeps a key when a release names another owner", async () => {
      const [store] = createStores();
      await held(store.claim("payment-a", TTL_MS));
      await store.release("payment-a", "someone-else");
      expect(await store.claim("payment-a", TTL_MS)).toBeNull();
    });

    it("ignores a late release after the key expired and another caller took it", async () => {
      const [first, second] = createStores();
      const lateOwner = await held(first.claim("payment-a", TTL_MS));
      vi.advanceTimersByTime(TTL_MS);
      const newOwner = await held(second.claim("payment-a", TTL_MS));
      await first.release("payment-a", lateOwner);
      expect(await first.claim("payment-a", TTL_MS)).toBeNull();
      await second.release("payment-a", newOwner);
      expect(await first.claim("payment-a", TTL_MS)).not.toBeNull();
    });

    it("ignores a late renewal after the key expired and another caller took it", async () => {
      const [first, second] = createStores();
      const lateOwner = await held(first.claim("payment-a", TTL_MS));
      vi.advanceTimersByTime(TTL_MS);
      const newOwner = await held(second.claim("payment-a", TTL_MS));
      vi.advanceTimersByTime(TTL_MS / 2);
      await first.renew("payment-a", lateOwner, TTL_MS);
      vi.advanceTimersByTime(TTL_MS / 2);
      expect(await first.claim("payment-a", TTL_MS)).not.toBeNull();
      expect(newOwner).not.toBe(lateOwner);
    });

    it("holds a renewed key for the full time from the renewal", async () => {
      const [store] = createStores();
      const owner = await held(store.claim("payment-a", TTL_MS));
      vi.advanceTimersByTime(TTL_MS - 10);
      await store.renew("payment-a", owner, TTL_MS);
      vi.advanceTimersByTime(TTL_MS - 1);
      expect(await store.claim("payment-a", TTL_MS)).toBeNull();
      vi.advanceTimersByTime(1);
      expect(await store.claim("payment-a", TTL_MS)).not.toBeNull();
    });

    it("lets the owner hold its key again after it lapsed while nobody took it", async () => {
      const [store] = createStores();
      const owner = await held(store.claim("payment-a", TTL_MS));
      vi.advanceTimersByTime(TTL_MS);
      await store.renew("payment-a", owner, TTL_MS);
      expect(await store.claim("payment-a", TTL_MS)).toBeNull();
      await store.release("payment-a", owner);
      expect(await store.claim("payment-a", TTL_MS)).not.toBeNull();
    });
  });
}

/** The owner token of a claim that must succeed. */
async function held(claim: Promise<string | null>): Promise<string> {
  const owner = await claim;
  if (owner === null) throw new Error("The claim was refused.");
  return owner;
}

describeClaimStore("MemoryClaimStore", () => {
  const store = new MemoryClaimStore();
  return [store, store];
});

describeClaimStore("RedisClaimStore", () => {
  const redis = new FakeRedis();
  return [new RedisClaimStore(redis.command), new RedisClaimStore(redis.command)];
});

describeClaimStore("PostgresClaimStore", () => {
  const postgres = new FakePostgres();
  return [new PostgresClaimStore(postgres), new PostgresClaimStore(postgres)];
});

describe("claimKeyDigest", () => {
  it("is the SHA-256 hex digest of the key", async () => {
    expect(await claimKeyDigest("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("RedisClaimStore commands", () => {
  it("claims with SET <owner> NX PX and renews or releases with owner-checking EVAL scripts under the prefix", async () => {
    const redis = new FakeRedis();
    const store = new RedisClaimStore(redis.command, { keyPrefix: "app:" });
    const stored = `app:${await claimKeyDigest("invoice:inv_1")}`;
    const owner = await held(store.claim("invoice:inv_1", 300_000));
    await store.renew("invoice:inv_1", owner, 300_000);
    await store.release("invoice:inv_1", owner);
    expect(redis.commands).toEqual([
      ["SET", stored, owner, "NX", "PX", "300000"],
      ["EVAL", expect.stringContaining('held == ARGV[1] then redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2])'), "1", stored, owner, "300000"],
      ["EVAL", expect.stringContaining('== ARGV[1] then return redis.call("DEL", KEYS[1])'), "1", stored, owner],
    ]);
  });

  it("uses the default prefix", async () => {
    const redis = new FakeRedis();
    await new RedisClaimStore(redis.command).claim("invoice:inv_1", TTL_MS);
    expect(redis.commands[0][1]).toBe(`solverr:x402:claim:${await claimKeyDigest("invoice:inv_1")}`);
  });

  it("throws on a reply that is neither OK nor null", async () => {
    const store = new RedisClaimStore(async () => 1);
    await expect(store.claim("invoice:inv_1", TTL_MS)).rejects.toThrow(/instead of "OK" or null/);
  });

  it("passes client errors on", async () => {
    const store = new RedisClaimStore(async () => {
      throw new Error("connection refused");
    });
    await expect(store.claim("invoice:inv_1", TTL_MS)).rejects.toThrow("connection refused");
  });
});

describe("PostgresClaimStore statements", () => {
  it("sends parameterized statements for the configured table with the hashed key and owner", async () => {
    const postgres = new FakePostgres();
    const store = new PostgresClaimStore(postgres, { table: "billing.claims" });
    const digest = await claimKeyDigest("invoice:inv_1");
    const owner = await held(store.claim("invoice:inv_1", 300_000));
    await store.renew("invoice:inv_1", owner, 300_000);
    await store.release("invoice:inv_1", owner);
    const [claim, renew, release] = postgres.statements;
    expect(claim.text).toContain("INSERT INTO billing.claims AS claim (claim_key, owner, expires_at)");
    expect(claim.text).toContain("WHERE claim.expires_at <= now() RETURNING claim_key");
    expect(claim.params).toEqual([digest, owner, 300_000]);
    expect(renew.text).toContain("WHERE claim.expires_at <= now() OR claim.owner = $2");
    expect(renew.params).toEqual([digest, owner, 300_000]);
    expect(release).toEqual({ text: "DELETE FROM billing.claims WHERE claim_key = $1 AND owner = $2", params: [digest, owner] });
  });

  it("refuses a table name that is not a plain lowercase identifier", () => {
    const postgres = new FakePostgres();
    expect(() => new PostgresClaimStore(postgres, { table: "claims; DROP TABLE users" })).toThrow(/table must be a lowercase name/);
    expect(() => new PostgresClaimStore(postgres, { table: "Claims" })).toThrow(/table must be a lowercase name/);
  });

  it("deletes expired rows on every 100th claim", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const postgres = new FakePostgres();
      const store = new PostgresClaimStore(postgres);
      for (let index = 0; index < 99; index++) await store.claim(`payment-${index}`, TTL_MS);
      vi.advanceTimersByTime(TTL_MS);
      expect(postgres.rowCount).toBe(99);
      await store.claim("payment-99", TTL_MS);
      expect(postgres.statements.filter((statement) => statement.text.endsWith("WHERE expires_at <= now()"))).toHaveLength(1);
      expect(postgres.rowCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
