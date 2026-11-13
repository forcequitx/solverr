import { claimKeyDigest, type ClaimStore } from "./claim-store.js";

/** Sends one raw command (`SET` or `EVAL`) to Redis or Valkey and resolves with its reply, for example
    node-redis `(args) => client.sendCommand(args)` or ioredis `([name, ...args]) => redis.call(name, ...args)`. */
export type RedisCommand = (args: string[]) => Promise<unknown>;

export interface RedisClaimStoreOptions {
  /** Put before every stored key; defaults to `solverr:x402:claim:`. */
  keyPrefix?: string;
}

const DEFAULT_KEY_PREFIX = "solverr:x402:claim:";
/** Sets the key to the owner token for ARGV[2] ms when it is free or already holds that token. */
const RENEW_SCRIPT = `local held = redis.call("GET", KEYS[1])
if held == false or held == ARGV[1] then redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2]) return 1 end
return 0`;
/** Deletes the key only while it holds the owner token. */
const RELEASE_SCRIPT = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end
return 0`;

/** Claims in Redis or Valkey, shared by every process that uses the same server: `SET key <owner> NX PX` claims, and Lua scripts sent with
    `EVAL` renew or release only for the owner. Keys are the prefix plus the SHA-256 of the claim key and expire on their own. */
export class RedisClaimStore implements ClaimStore {
  private readonly keyPrefix: string;

  constructor(
    private readonly command: RedisCommand,
    options: RedisClaimStoreOptions = {},
  ) {
    this.keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
  }

  async claim(key: string, ttlMs: number): Promise<string | null> {
    const owner = crypto.randomUUID();
    const reply = await this.command(["SET", await this.storedKey(key), owner, "NX", "PX", String(ttlMs)]);
    if (reply === "OK") return owner;
    if (reply === null) return null;
    throw new Error(`Redis answered SET NX with ${JSON.stringify(reply)?.slice(0, 100)} instead of "OK" or null.`);
  }

  async renew(key: string, owner: string, ttlMs: number): Promise<void> {
    await this.command(["EVAL", RENEW_SCRIPT, "1", await this.storedKey(key), owner, String(ttlMs)]);
  }

  async release(key: string, owner: string): Promise<void> {
    await this.command(["EVAL", RELEASE_SCRIPT, "1", await this.storedKey(key), owner]);
  }

  private async storedKey(key: string): Promise<string> {
    return this.keyPrefix + (await claimKeyDigest(key));
  }
}
