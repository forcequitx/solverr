import { randomBytes } from "node:crypto";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** Largest multiple of 58 below 256; bytes at or above it are skipped to avoid modulo bias. */
const UNBIASED_LIMIT = 232;

/** Cryptographically random base58 string. */
export function randomToken(length: number): string {
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte < UNBIASED_LIMIT) out += BASE58[byte % 58];
      if (out.length === length) break;
    }
  }
  return out;
}

type IdPrefix =
  | "mer"
  | "key"
  | "inv"
  | "idem"
  | "quo"
  | "pev"
  | "evt"
  | "alr"
  | "case"
  | "wid"
  | "tm"
  | "vrf"
  | "lnk"
  | "cra"
  | "cru"
  | "ref"
  | "pay"
  | "bat"
  | "sub"
  | "spl"
  | "tg"
  | "logo";

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomToken(20)}`;
}
