import { sha256 } from "@noble/hashes/sha2.js";
import { base32nopad, base58, base58xrp, base64nopad, base64urlnopad, bech32, bech32m } from "@scure/base";
import { getAddress as getEvmAddress, isAddress as isEvmAddress } from "viem";
import type { ChainFamily } from "@/lib/chains/registry";

const sha256d = (data: Uint8Array) => sha256(sha256(data));

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function attempt<T>(run: () => T): T | undefined {
  try {
    return run();
  } catch {
    return undefined;
  }
}

/** Decodes base58check (payload + 4-byte double-SHA256 checksum) with the given alphabet decoder. */
function decodeBase58Check(value: string, decoder: { decode(s: string): Uint8Array } = base58): Uint8Array | undefined {
  const raw = attempt(() => decoder.decode(value));
  if (!raw || raw.length < 5) return undefined;
  const payload = raw.slice(0, -4);
  return equalBytes(sha256d(payload).slice(0, 4), raw.slice(-4)) ? payload : undefined;
}

/** Legacy base58 address: one version byte plus a 20-byte hash. */
function isBase58Legacy(value: string, versions: number[]): boolean {
  const payload = decodeBase58Check(value);
  return !!payload && payload.length === 21 && versions.includes(payload[0]);
}

/** Native SegWit address (v0 uses bech32, v1+ uses bech32m). */
function isSegwit(value: string, hrp: string): boolean {
  const lower = value.toLowerCase();
  if (value !== lower && value !== value.toUpperCase()) return false;
  if (!lower.startsWith(`${hrp}1`)) return false;
  const decoded = attempt(() => bech32.decode(lower as `${string}1${string}`)) ?? attempt(() => bech32m.decode(lower as `${string}1${string}`));
  if (!decoded || decoded.prefix !== hrp || decoded.words.length === 0) return false;
  const version = decoded.words[0];
  const usesBech32m = attempt(() => bech32m.decode(lower as `${string}1${string}`)) !== undefined;
  if (version === 0 && usesBech32m) return false;
  if (version > 0 && !usesBech32m) return false;
  const program = attempt(() => bech32.fromWords(decoded.words.slice(1)));
  if (!program) return false;
  if (version === 0) return program.length === 20 || program.length === 32;
  return version <= 16 && program.length >= 2 && program.length <= 40;
}

/** CashAddr checksum (BCH spec: BCH-code polymod over 5-bit groups). */
function cashAddrPolymod(values: number[]): bigint {
  const generators = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];
  let checksum = 1n;
  for (const value of values) {
    const top = checksum >> 35n;
    checksum = ((checksum & 0x07ffffffffn) << 5n) ^ BigInt(value);
    generators.forEach((generator, i) => {
      if ((top >> BigInt(i)) & 1n) checksum ^= generator;
    });
  }
  return checksum ^ 1n;
}

function isCashAddr(value: string): boolean {
  const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const lower = value.toLowerCase();
  if (value !== lower && value !== value.toUpperCase()) return false;
  const body = lower.startsWith("bitcoincash:") ? lower.slice(12) : lower;
  if (!/^[qp][qpzry9x8gf2tvdw0s3jn54khce6mua7l]{41}$/.test(body)) return false;
  const prefixValues = [..."bitcoincash"].map((c) => c.charCodeAt(0) & 31);
  const data = [...body].map((c) => CHARSET.indexOf(c));
  return cashAddrPolymod([...prefixValues, 0, ...data]) === 0n;
}

/** CRC16-XModem, used by Stellar StrKey and TON user-friendly addresses. */
function crc16xmodem(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

function isStellar(value: string): boolean {
  if (!/^G[A-Z2-7]{55}$/.test(value)) return false;
  const raw = attempt(() => base32nopad.decode(value));
  if (!raw || raw.length !== 35 || raw[0] !== 6 << 3) return false;
  const crc = crc16xmodem(raw.slice(0, 33));
  return raw[33] === (crc & 0xff) && raw[34] === crc >> 8;
}

function isTon(value: string): boolean {
  if (/^-?[01]:[0-9a-fA-F]{64}$/.test(value)) return true;
  if (!/^[A-Za-z0-9_\-+/]{48}$/.test(value)) return false;
  const raw = attempt(() => (/[-_]/.test(value) ? base64urlnopad.decode(value) : base64nopad.decode(value)));
  if (!raw || raw.length !== 36) return false;
  const crc = crc16xmodem(raw.slice(0, 34));
  return raw[34] === crc >> 8 && raw[35] === (crc & 0xff);
}

function isXrp(value: string): boolean {
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(value)) return false;
  const payload = decodeBase58Check(value, base58xrp);
  return !!payload && payload.length === 21 && payload[0] === 0;
}

function isTron(value: string): boolean {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) return false;
  const payload = decodeBase58Check(value);
  return !!payload && payload.length === 21 && payload[0] === 0x41;
}

function isZcashTransparent(value: string): boolean {
  const payload = decodeBase58Check(value);
  /** t1 (P2PKH, 0x1cb8) and t3 (P2SH, 0x1cbd) transparent addresses. */
  return !!payload && payload.length === 22 && payload[0] === 0x1c && (payload[1] === 0xb8 || payload[1] === 0xbd);
}

function isSolana(value: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  return attempt(() => base58.decode(value))?.length === 32;
}

const NEAR_NAMED = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

function isNear(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value) || /^0x[0-9a-f]{40}$/.test(value) || NEAR_NAMED.test(value);
}

function isCardano(value: string): boolean {
  if (!value.startsWith("addr1")) return false;
  const decoded = attempt(() => bech32.decode(value as `${string}1${string}`, 1023));
  return decoded?.prefix === "addr";
}

const VALIDATORS: Record<ChainFamily, (value: string) => boolean> = {
  evm: (v) => /^0x[0-9a-fA-F]{40}$/.test(v) && isEvmAddress(v, { strict: true }),
  solana: isSolana,
  near: isNear,
  tron: isTron,
  bitcoin: (v) => isSegwit(v, "bc") || isBase58Legacy(v, [0x00, 0x05]),
  litecoin: (v) => isSegwit(v, "ltc") || isBase58Legacy(v, [0x30, 0x32, 0x05]),
  dogecoin: (v) => isBase58Legacy(v, [0x1e, 0x16]),
  bitcoincash: (v) => isCashAddr(v) || isBase58Legacy(v, [0x00, 0x05]),
  dash: (v) => isBase58Legacy(v, [0x4c, 0x10]),
  zcash: isZcashTransparent,
  xrp: isXrp,
  stellar: isStellar,
  ton: isTon,
  sui: (v) => /^0x[0-9a-fA-F]{64}$/.test(v),
  aptos: (v) => /^0x[0-9a-fA-F]{64}$/.test(v),
  cardano: isCardano,
  starknet: (v) => /^0x[0-9a-fA-F]{1,64}$/.test(v),
};

/** True when `address` is a well-formed address for the chain family (checksums verified where the format has one). */
export function isValidAddress(family: ChainFamily, address: string): boolean {
  const value = address.trim();
  return value.length > 0 && value.length <= 200 && VALIDATORS[family](value);
}

/** The stored spelling of a valid address: EVM addresses are checksummed, so one wallet never appears under two spellings. */
export function canonicalAddress(family: ChainFamily, address: string): string {
  return family === "evm" ? getEvmAddress(address.trim()) : address.trim();
}
