import { access, readFile, utimes, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DAY_MS, SPEND_LOG_RETENTION_MS } from "../src/config.js";
import { SpendLog, type SpendEntry } from "../src/spend-log.js";
import { tempDir } from "./fixtures.js";

let dir: string;
let cleanup: () => Promise<void>;
let path: string;

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  path = join(dir, "nested", "spend-log.json");
});

afterEach(async () => {
  await cleanup();
});

const draft = (amountUsd: number, invoiceId = "inv_1") => ({ url: "https://api.example.com/x", host: "api.example.com", invoice_id: invoiceId, amount_usd: amountUsd, status: "reserved" as const });

const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

function entry(id: string, amountUsd: number, status: SpendEntry["status"], createdAt: string): SpendEntry {
  return { ...draft(amountUsd), id, status, created_at: createdAt };
}

async function writeLog(entries: SpendEntry[]) {
  const log = new SpendLog(path);
  await log.reserve(draft(0), () => undefined);
  await writeFile(path, JSON.stringify({ version: 1, entries }), "utf8");
  return log;
}

/** A check that refuses once the last 24 hours plus `amount` would pass `limit`. */
const underLimit = (limit: number, amount: number) => (spent: number) => {
  if (spent + amount > limit) throw new Error("daily limit");
};

const exists = (file: string) => access(file).then(() => true, () => false);

describe("SpendLog", () => {
  it("treats a missing file as an empty log", async () => {
    const log = new SpendLog(path);
    await expect(log.entries()).resolves.toEqual([]);
    await expect(log.spentLast24hUsd()).resolves.toBe(0);
  });

  it("reserves an entry with an ID and time, creating the folder and a version 1 file", async () => {
    const log = new SpendLog(path);
    const created = await log.reserve(draft(2.5), () => undefined);
    expect(created).toMatchObject({ amount_usd: 2.5, status: "reserved" });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(created.created_at)).not.toBeNaN();
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ version: 1, entries: [created] });
    expect(await exists(`${path}.lock`)).toBe(false);
  });

  it("counts every status except aborted, and only the last 24 hours", async () => {
    const log = await writeLog([
      entry("a", 1, "reserved", daysAgo(0)),
      entry("b", 2, "sent", daysAgo(0.5)),
      entry("c", 4, "paid", daysAgo(0.9)),
      entry("d", 8, "failed", daysAgo(0.1)),
      entry("e", 16, "aborted", daysAgo(0)),
      entry("f", 32, "paid", daysAgo(1.1)),
    ]);
    await expect(log.spentLast24hUsd()).resolves.toBe(15);
    const check = vi.fn();
    await log.reserve(draft(1), check);
    expect(check).toHaveBeenCalledWith(15);
  });

  it("writes nothing when the reserve check throws", async () => {
    const log = new SpendLog(path);
    await log.reserve(draft(4), () => undefined);
    await expect(log.reserve(draft(2), underLimit(5, 2))).rejects.toThrow("daily limit");
    expect(await log.entries()).toHaveLength(1);
    expect(await exists(`${path}.lock`)).toBe(false);
  });

  it("updates an entry after checking the total of all other entries", async () => {
    const log = new SpendLog(path);
    await log.reserve(draft(3), () => undefined);
    const mine = await log.reserve(draft(1), () => undefined);
    const check = vi.fn();
    const updated = await log.update(mine.id, { amount_usd: 1.5, status: "sent", tx_hash: "0xabc" }, check);
    expect(check).toHaveBeenCalledWith(3);
    expect(updated).toMatchObject({ id: mine.id, amount_usd: 1.5, status: "sent", tx_hash: "0xabc", created_at: mine.created_at });
    expect((await log.entries()).find((item) => item.id === mine.id)).toEqual(updated);
  });

  it("keeps the entry unchanged when the update check throws", async () => {
    const log = new SpendLog(path);
    const mine = await log.reserve(draft(1), () => undefined);
    await expect(log.update(mine.id, { amount_usd: 9 }, underLimit(5, 9))).rejects.toThrow("daily limit");
    expect((await log.entries())[0].amount_usd).toBe(1);
  });

  it("refuses to update an unknown entry", async () => {
    const log = new SpendLog(path);
    await expect(log.update("missing", { status: "paid" })).rejects.toThrow("missing not found");
  });

  it.each([
    ["not JSON", "{oops"],
    ["JSON null", "null"],
    ["another version", JSON.stringify({ version: 2, entries: [] })],
    ["entries that are not a list", JSON.stringify({ version: 1, entries: {} })],
  ])("refuses a corrupt log (%s) instead of resetting the total", async (_name, text) => {
    const log = new SpendLog(path);
    await log.reserve(draft(0), () => undefined);
    await writeFile(path, text, "utf8");
    await expect(log.entries()).rejects.toThrow("not a valid spend log file");
    await expect(log.reserve(draft(1), () => undefined)).rejects.toThrow("not a valid spend log file");
  });

  it("drops entries past the retention period on the next write", async () => {
    const old = entry("old", 1, "paid", new Date(Date.now() - SPEND_LOG_RETENTION_MS - 60_000).toISOString());
    const recent = entry("recent", 1, "paid", daysAgo(2));
    const log = await writeLog([old, recent]);
    await log.reserve(draft(1), () => undefined);
    expect((await log.entries()).map((item) => item.id)).toEqual(["recent", expect.any(String)]);
  });

  it("lets only as many concurrent reservations from two instances pass as the limit allows", async () => {
    const first = new SpendLog(path);
    const second = new SpendLog(path);
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, index) => (index % 2 ? first : second).reserve(draft(1, `inv_${index}`), underLimit(5, 1))));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(5);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(5);
    expect(await first.entries()).toHaveLength(5);
    await expect(second.spentLast24hUsd()).resolves.toBe(5);
    expect(await exists(`${path}.lock`)).toBe(false);
  });

  it("waits for a lock held by another process and continues once it is released", async () => {
    const log = new SpendLog(path);
    await log.reserve(draft(0), () => undefined);
    await writeFile(`${path}.lock`, "other-holder", "utf8");
    let settled = false;
    const pending = log.reserve(draft(1), () => undefined).finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(settled).toBe(false);
    await rm(`${path}.lock`);
    await expect(pending).resolves.toMatchObject({ amount_usd: 1 });
    expect(await log.entries()).toHaveLength(2);
  });

  it("takes over a stale lock left by a process that stopped", async () => {
    const log = new SpendLog(path);
    await log.reserve(draft(0), () => undefined);
    const lockPath = `${path}.lock`;
    await writeFile(lockPath, "crashed-holder", "utf8");
    const old = new Date(Date.now() - 5 * 60_000);
    await utimes(lockPath, old, old);
    await expect(log.reserve(draft(1), () => undefined)).resolves.toMatchObject({ amount_usd: 1 });
    expect(await exists(lockPath)).toBe(false);
    expect(await exists(`${lockPath}.crashed-holder.takeover`)).toBe(false);
  });
});
