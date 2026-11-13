import { fetchTokens, OneClickError } from "@/lib/oneclick/client";
import type { OneClickToken } from "@/lib/oneclick/types";
import { createRefreshingCache } from "@/lib/refreshing-cache";

const USD_STABLECOINS = new Set(["USDC", "USDT", "DAI"]);

/** Supported tokens from 1Click, cached for 60 seconds; a list up to 10 minutes old is served while a refresh runs or fails. */
export const listTokens = createRefreshingCache({ freshMs: 60_000, staleMs: 10 * 60_000, load: fetchTokens });

/** The longest a request someone is waiting on waits for a cold token list: the SDKs give up after 15 seconds. */
const REQUEST_WAIT_MS = 10_000;

export async function findToken(assetId: string): Promise<OneClickToken | undefined> {
  return (await listTokens()).find((token) => token.assetId === assetId);
}

/** Waits at most REQUEST_WAIT_MS for a token lookup someone is waiting on: a cold load still running then fails as a 502, which clients
    retry, instead of outliving the client; the load goes on and fills the cache for that retry. */
export async function withinRequestWait<T>(lookup: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OneClickError(`The 1Click token list took over ${REQUEST_WAIT_MS} ms`)), REQUEST_WAIT_MS);
  });
  try {
    return await Promise.race([lookup, slow]);
  } finally {
    clearTimeout(timer);
  }
}

let lastListed: OneClickToken[] = [];

/** Token list for display-only pages: the last list read, however old, while 1Click is down (empty before any read); payments use `listTokens`. */
export async function displayTokens(): Promise<OneClickToken[]> {
  try {
    lastListed = await listTokens();
  } catch {
    /** The last list read stays in use until 1Click answers again. */
  }
  return lastListed;
}

export function isUsdStablecoin(token: OneClickToken): boolean {
  return USD_STABLECOINS.has(token.symbol);
}
