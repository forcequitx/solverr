import { createHash } from "node:crypto";
import { isIPv6 } from "node:net";
import { ApiError } from "@/lib/api/errors";
import { getDb } from "@/lib/db";
import { formatWait } from "@/lib/format";
import { DAY_MS } from "@/lib/time";

/** Longest key stored as it is; longer ones (built from ids in the URL) are stored as a hash, which fits the primary-key index. */
const MAX_STORED_KEY_LENGTH = 200;

/** Fixed-window limiter in Postgres, so every web instance counts together; one statement starts a new window or adds `cost`.
    The database clock decides, not the instance's. Always await it, or its 429 becomes an unhandled rejection. */
export async function rateLimit(key: string, limit: number, windowMs: number, cost = 1): Promise<void> {
  const stored = key.length > MAX_STORED_KEY_LENGTH ? `sha256:${createHash("sha256").update(key).digest("hex")}` : key;
  const [row] = await getDb().$queryRaw<{ count: number; retry_after: number }[]>`
    INSERT INTO rate_limit_windows (key, count, window_end)
    VALUES (${stored}, ${cost}, now() + ${windowMs} * interval '1 millisecond')
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limit_windows.window_end <= now() THEN EXCLUDED.count ELSE rate_limit_windows.count + EXCLUDED.count END,
      window_end = CASE WHEN rate_limit_windows.window_end <= now() THEN EXCLUDED.window_end ELSE rate_limit_windows.window_end END
    RETURNING count, ceil(extract(epoch FROM window_end - now()))::int AS retry_after`;
  if (row.count > limit) {
    const retryAfter = Math.max(1, row.retry_after);
    throw new ApiError(429, "rate_limited", `Too many requests. Try again in ${formatWait(retryAfter)}.`, undefined, retryAfter);
  }
}

/** Worker job: deletes ended windows, and Better Auth's counters idle for a day. */
export async function pruneRateLimits(): Promise<number> {
  const db = getDb();
  const [windows, auth] = await Promise.all([
    db.requestWindow.deleteMany({ where: { windowEnd: { lt: new Date() } } }),
    db.rateLimit.deleteMany({ where: { lastRequest: { lt: BigInt(Date.now() - DAY_MS) } } }),
  ]);
  return windows.count + auth.count;
}

/** Client IP as forwarded by the reverse proxy; IPv4-mapped IPv6 becomes IPv4, other IPv6 its /64 (one client usually holds a /64). */
export function clientIp(request: Request): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const address = ip.split("%")[0];
  if (!isIPv6(address)) return ip;

  const groups = ipv6Groups(address);
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

/** The client's IPv4 address or IPv6 /48; one user can hold many /64s in a /48, so public endpoints also limit this, at or above the per-IP limit. */
export function clientNetwork(request: Request): string {
  const ip = clientIp(request);
  if (!ip.endsWith("::/64")) return ip;
  return `${ip.split(":").slice(0, 3).join(":")}::/48`;
}

/** Expands a valid IPv6 address, including `::` and a dotted IPv4 tail, to its eight 16-bit groups. */
function ipv6Groups(address: string): number[] {
  const parse = (part: string | undefined) =>
    !part
      ? []
      : part.split(":").flatMap((group) => {
          if (!group.includes(".")) return [parseInt(group, 16)];
          const [a, b, c, d] = group.split(".").map(Number);
          return [(a << 8) | b, (c << 8) | d];
        });
  const [head, tail] = address.split("::");
  const left = parse(head);
  if (tail === undefined) return left;
  const right = parse(tail);
  return [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right];
}
