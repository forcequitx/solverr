/** Keeps payment claims so one payment unlocks one request at a time. A store that every instance of a deployment shares,
    such as `RedisClaimStore` or `PostgresClaimStore`, extends that rule across serverless instances and processes. */
export interface ClaimStore {
  /** Holds `key` for `ttlMs` and returns a new random owner token, or null while it is held; one atomic step for every user of the store. */
  claim(key: string, ttlMs: number): Promise<string | null>;
  /** Holds `key` for `ttlMs` from now when `owner` holds it or nobody does; a key another owner took after expiry stays untouched. */
  renew(key: string, owner: string, ttlMs: number): Promise<void>;
  /** Frees `key` only while `owner` holds it. */
  release(key: string, owner: string): Promise<void>;
}

/** Claims kept in this process's memory: enough for one long-running server process, not for serverless or several processes. */
export class MemoryClaimStore implements ClaimStore {
  /** Each held key with its owner token and the time its claim lapses. */
  private readonly claims = new Map<string, { owner: string; lapsesAt: number }>();

  async claim(key: string, ttlMs: number): Promise<string | null> {
    const now = Date.now();
    for (const [held, claim] of this.claims) if (claim.lapsesAt <= now) this.claims.delete(held);
    if (this.claims.has(key)) return null;
    const owner = crypto.randomUUID();
    this.claims.set(key, { owner, lapsesAt: now + ttlMs });
    return owner;
  }

  async renew(key: string, owner: string, ttlMs: number): Promise<void> {
    const now = Date.now();
    const claim = this.claims.get(key);
    if (!claim || claim.lapsesAt <= now || claim.owner === owner) this.claims.set(key, { owner, lapsesAt: now + ttlMs });
  }

  async release(key: string, owner: string): Promise<void> {
    if (this.claims.get(key)?.owner === owner) this.claims.delete(key);
  }
}

/** The SHA-256 hex digest of a claim key, so shared stores keep fixed-length keys even when a key holds a whole signed payload. */
export async function claimKeyDigest(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
