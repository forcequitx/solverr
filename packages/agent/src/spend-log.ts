import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DAY_MS, SPEND_LOG_LOCK_RETRY_MS, SPEND_LOG_LOCK_TIMEOUT_MS, SPEND_LOG_RETENTION_MS, SPEND_LOG_STALE_LOCK_MS } from "./config.js";
import { sleep } from "./timeout.js";

/** `reserved`: limits checked, nothing sent. `sent`: transfer broadcast. `paid`: invoice paid.
    `failed`: funds were sent but the invoice was not paid. `aborted`: stopped before any transfer. */
export type SpendStatus = "reserved" | "sent" | "paid" | "failed" | "aborted";

export interface SpendEntry {
  id: string;
  created_at: string;
  url: string;
  host: string;
  invoice_id: string;
  amount_usd: number;
  status: SpendStatus;
  asset_id?: string;
  blockchain?: string;
  amount_base?: string;
  tx_hash?: string;
  error?: string;
}

export type SpendChanges = Partial<Omit<SpendEntry, "id" | "created_at">>;

/** Throws to refuse a write; receives the USD counted over the last 24 hours, excluding the entry being written. */
export type SpendCheck = (spentLast24hUsd: number) => void;

interface SpendLogFile {
  version: 1;
  entries: SpendEntry[];
}

const DEFAULT_SPEND_LOG_PATH = join(homedir(), ".solverr", "agent-spend-log.json");

/** Every status except `aborted` counts toward the daily limit, since funds may have left the wallet. */
const counts = (entry: SpendEntry) => entry.status !== "aborted";

function spentLast24h(entries: readonly SpendEntry[], exceptId?: string): number {
  const since = Date.now() - DAY_MS;
  return entries
    .filter((entry) => entry.id !== exceptId && counts(entry) && Date.parse(entry.created_at) >= since)
    .reduce((sum, entry) => sum + entry.amount_usd, 0);
}

interface LockState {
  /** Random ID its holder wrote into the lock file. */
  token: string;
  stale: boolean;
}

/** On Windows a lock file that is being deleted refuses to open with EPERM, which means the same as EEXIST here. */
const isLockBusy = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EEXIST" || (code === "EPERM" && process.platform === "win32");
};

/** Reads the lock file's token and whether it is older than the stale limit; `undefined` when there is no lock. */
async function readLock(lockPath: string): Promise<LockState | undefined> {
  try {
    const [{ mtimeMs }, token] = await Promise.all([stat(lockPath), readFile(lockPath, "utf8")]);
    return { token, stale: Date.now() - mtimeMs >= SPEND_LOG_STALE_LOCK_MS };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (isLockBusy(error)) return { token: "", stale: false };
    throw error;
  }
}

/** Removes a stale lock file and returns whether it may now be free. Only the waiter that creates this token's takeover file
    removes it, after reading the lock again, so a fresh lock another waiter took meanwhile is never deleted. */
async function removeStaleLock(lockPath: string): Promise<boolean> {
  const lock = await readLock(lockPath);
  if (!lock) return true;
  if (!lock.stale) return false;
  const claimPath = `${lockPath}.${/^[\w-]{1,64}$/.test(lock.token) ? lock.token : "unknown"}.takeover`;
  let claim: FileHandle;
  try {
    claim = await open(claimPath, "wx", 0o600);
  } catch (error) {
    if (isLockBusy(error)) return false;
    throw error;
  }
  try {
    const current = await readLock(lockPath);
    if (current?.stale && current.token === lock.token) await rm(lockPath, { force: true });
  } finally {
    await claim.close();
    await rm(claimPath, { force: true });
  }
  return true;
}

/** Local JSON record of payments that enforces the rolling 24-hour limit across restarts and processes.
    Every write re-reads the file under an exclusive lock file, so agents sharing one log never overwrite each other. */
export class SpendLog {
  constructor(readonly path: string = DEFAULT_SPEND_LOG_PATH) {}

  /** Reads the file; a missing file is an empty log, a corrupt one is an error so limits are never reset silently. */
  async entries(): Promise<SpendEntry[]> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return [];
    }
    let parsed: Partial<SpendLogFile> | null;
    try {
      parsed = JSON.parse(text) as Partial<SpendLogFile> | null;
    } catch {
      parsed = null;
    }
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) throw new Error(`Spend log ${this.path} is not a valid spend log file.`);
    return parsed.entries;
  }

  /** USD counted toward the daily limit over the last 24 hours. */
  async spentLast24hUsd(): Promise<number> {
    return spentLast24h(await this.entries());
  }

  /** Runs `check` against the current total and adds the entry in one locked step, so two processes cannot both pass the limit. */
  async reserve(entry: Omit<SpendEntry, "id" | "created_at">, check: SpendCheck): Promise<SpendEntry> {
    return this.withLock(async () => {
      const entries = await this.entries();
      check(spentLast24h(entries));
      const created: SpendEntry = { id: randomUUID(), created_at: new Date().toISOString(), ...entry };
      entries.push(created);
      await this.save(entries);
      return created;
    });
  }

  /** Applies `changes` to entry `id`, after `check` passes against the total of all other entries. */
  async update(id: string, changes: SpendChanges, check?: SpendCheck): Promise<SpendEntry> {
    return this.withLock(async () => {
      const entries = await this.entries();
      const entry = entries.find((item) => item.id === id);
      if (!entry) throw new Error(`Spend log entry ${id} not found.`);
      check?.(spentLast24h(entries, id));
      Object.assign(entry, changes);
      await this.save(entries);
      return entry;
    });
  }

  /** Holds `${path}.lock` (created with `wx`, holding a random token) while `run` reads and writes the log. */
  private async withLock<T>(run: () => Promise<T>): Promise<T> {
    const lockPath = `${this.path}.lock`;
    await mkdir(dirname(this.path), { recursive: true });
    const deadline = Date.now() + SPEND_LOG_LOCK_TIMEOUT_MS;
    const token = randomUUID();
    let lock: FileHandle | undefined;
    while (!lock) {
      try {
        lock = await open(lockPath, "wx", 0o600);
      } catch (error) {
        if (!isLockBusy(error)) throw error;
        if (await removeStaleLock(lockPath)) continue;
        if (Date.now() >= deadline) {
          throw new Error(`Spend log ${this.path} stayed locked for ${SPEND_LOG_LOCK_TIMEOUT_MS / 1000} s. If no other agent is running, delete ${lockPath}.`);
        }
        await sleep(SPEND_LOG_LOCK_RETRY_MS);
      }
    }
    try {
      await lock.writeFile(token, "utf8");
      return await run();
    } finally {
      await lock.close();
      /** A lock taken over after going stale belongs to its new holder and is left in place. */
      if ((await readLock(lockPath))?.token === token) await rm(lockPath, { force: true });
    }
  }

  /** Writes to a temporary file and renames it, so a crash never leaves a half-written log. */
  private async save(entries: readonly SpendEntry[]): Promise<void> {
    const cutoff = Date.now() - SPEND_LOG_RETENTION_MS;
    const file: SpendLogFile = { version: 1, entries: entries.filter((entry) => Date.parse(entry.created_at) >= cutoff) };
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.path);
  }
}
