import { claimKeyDigest, type ClaimStore } from "./claim-store.js";

/** Runs one parameterized statement and resolves with its rows, as a `pg` Pool or Client does; other clients fit with a small wrapper,
    for example postgres.js: `{ query: async (text, params) => ({ rows: await sql.unsafe(text, params) }) }`. */
export interface PostgresQuery {
  query(text: string, params: (string | number)[]): Promise<{ rows: unknown[] }>;
}

export interface PostgresClaimStoreOptions {
  /** Table that holds the claims, optionally schema-qualified; lowercase letters, digits and `_`. Defaults to `x402_payment_claims`. */
  table?: string;
}

const DEFAULT_TABLE = "x402_payment_claims";
const TABLE_NAME_PATTERN = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;
/** Expired rows are deleted on every this many claims made through one store instance. */
const PRUNE_EVERY_CLAIMS = 100;

/** Claims in a Postgres table (`claim_key text PRIMARY KEY, owner text NOT NULL, expires_at timestamptz NOT NULL`) shared by every process.
    A claim inserts the key or takes over an expired row in one statement; renew and release match the owner. Expiry uses the database clock. */
export class PostgresClaimStore implements ClaimStore {
  private readonly claimSql: string;
  private readonly renewSql: string;
  private readonly releaseSql: string;
  private readonly pruneSql: string;
  private claims = 0;

  constructor(
    private readonly client: PostgresQuery,
    options: PostgresClaimStoreOptions = {},
  ) {
    const table = options.table ?? DEFAULT_TABLE;
    if (!TABLE_NAME_PATTERN.test(table)) {
      throw new Error(`table must be a lowercase name such as "x402_payment_claims" or "billing.claims"; got ${JSON.stringify(table)}.`);
    }
    const upsert = `INSERT INTO ${table} AS claim (claim_key, owner, expires_at) VALUES ($1, $2, now() + $3::float8 * interval '1 millisecond')
      ON CONFLICT (claim_key) DO UPDATE SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at WHERE claim.expires_at <= now()`;
    this.claimSql = `${upsert} RETURNING claim_key`;
    this.renewSql = `${upsert} OR claim.owner = $2`;
    this.releaseSql = `DELETE FROM ${table} WHERE claim_key = $1 AND owner = $2`;
    this.pruneSql = `DELETE FROM ${table} WHERE expires_at <= now()`;
  }

  async claim(key: string, ttlMs: number): Promise<string | null> {
    if (++this.claims % PRUNE_EVERY_CLAIMS === 0) await this.prune();
    const owner = crypto.randomUUID();
    const { rows } = await this.client.query(this.claimSql, [await claimKeyDigest(key), owner, ttlMs]);
    return rows.length > 0 ? owner : null;
  }

  async renew(key: string, owner: string, ttlMs: number): Promise<void> {
    await this.client.query(this.renewSql, [await claimKeyDigest(key), owner, ttlMs]);
  }

  async release(key: string, owner: string): Promise<void> {
    await this.client.query(this.releaseSql, [await claimKeyDigest(key), owner]);
  }

  /** Deletes expired claims. Claims call it on their own every PRUNE_EVERY_CLAIMS calls; a scheduled job may call it too. */
  async prune(): Promise<void> {
    await this.client.query(this.pruneSql, []);
  }
}
