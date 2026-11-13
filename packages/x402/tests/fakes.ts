import type { PostgresQuery } from "../src/postgres-claim-store.js";
import type { RedisCommand } from "../src/redis-claim-store.js";

/** Lets other pending work run first, as a network round trip would. */
const roundTrip = () => new Promise<void>((resolve) => queueMicrotask(resolve));

/** A stored claim: its owner token and the time it lapses. */
interface StoredClaim {
  owner: string;
  expiresAt: number;
}

/** An in-memory Redis that understands `SET key value NX PX ms` and the store's two `EVAL` scripts, each applied atomically. */
export class FakeRedis {
  readonly commands: string[][] = [];
  private readonly entries = new Map<string, StoredClaim>();

  readonly command: RedisCommand = async (args) => {
    this.commands.push(args);
    await roundTrip();
    const now = Date.now();
    const held = (key: string) => {
      const entry = this.entries.get(key);
      return entry && entry.expiresAt > now ? entry.owner : undefined;
    };
    if (args[0] === "SET" && args[3] === "NX" && args[4] === "PX") {
      const [, key, owner, , , ttlMs] = args;
      if (held(key) !== undefined) return null;
      this.entries.set(key, { owner, expiresAt: now + Number(ttlMs) });
      return "OK";
    }
    if (args[0] === "EVAL" && args[2] === "1") {
      const [, script, , key, owner, ttlMs] = args;
      const current = held(key);
      if (script.includes('"DEL"')) return Number(current === owner && this.entries.delete(key));
      if (current !== undefined && current !== owner) return 0;
      this.entries.set(key, { owner, expiresAt: now + Number(ttlMs) });
      return 1;
    }
    throw new Error(`FakeRedis does not know ${args[0]}.`);
  };
}

/** An in-memory Postgres for the statements `PostgresClaimStore` sends, applied atomically with the expiry and owner rules of the real SQL. */
export class FakePostgres implements PostgresQuery {
  readonly statements: { text: string; params: (string | number)[] }[] = [];
  private readonly rows = new Map<string, StoredClaim>();

  get rowCount(): number {
    return this.rows.size;
  }

  async query(text: string, params: (string | number)[]): Promise<{ rows: unknown[] }> {
    this.statements.push({ text, params });
    await roundTrip();
    const now = Date.now();
    const [key, owner, ttlMs] = params.map(String);
    const row = this.rows.get(key);
    if (text.startsWith("INSERT")) {
      const takesRow = !row || row.expiresAt <= now || (text.endsWith("OR claim.owner = $2") && row.owner === owner);
      if (takesRow) this.rows.set(key, { owner, expiresAt: now + Number(ttlMs) });
      return { rows: takesRow && text.endsWith("RETURNING claim_key") ? [{ claim_key: key }] : [] };
    }
    if (text.endsWith("WHERE claim_key = $1 AND owner = $2")) {
      if (row?.owner === owner) this.rows.delete(key);
      return { rows: [] };
    }
    if (text.endsWith("WHERE expires_at <= now()")) {
      for (const [held, claim] of this.rows) if (claim.expiresAt <= now) this.rows.delete(held);
      return { rows: [] };
    }
    throw new Error(`FakePostgres does not know: ${text}`);
  }
}
