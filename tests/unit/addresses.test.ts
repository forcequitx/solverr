import { sha256 } from "@noble/hashes/sha2.js";
import { base32nopad, base58, base64nopad, base64urlnopad, bech32, bech32m } from "@scure/base";
import { describe, expect, it } from "vitest";
import { canonicalAddress, isValidAddress } from "@/lib/chains/addresses";

/** Builders for well-formed addresses with real checksums, so each format is tested beyond a handful of fixed examples. */
const bytes = (length: number, seed = 7) => Uint8Array.from({ length }, (_, index) => (index * 31 + seed) % 256);
const doubleSha = (data: Uint8Array) => sha256(sha256(data));

function base58Check(version: number[], payload: Uint8Array): string {
  const body = Uint8Array.from([...version, ...payload]);
  return base58.encode(Uint8Array.from([...body, ...doubleSha(body).slice(0, 4)]));
}

function segwit(hrp: string, version: number, program: Uint8Array, encoding = version === 0 ? bech32 : bech32m): string {
  return encoding.encode(hrp, [version, ...bech32.toWords(program)]);
}

function crc16xmodem(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

function stellarAccount(key: Uint8Array): string {
  const body = Uint8Array.from([6 << 3, ...key]);
  const crc = crc16xmodem(body);
  return base32nopad.encode(Uint8Array.from([...body, crc & 0xff, crc >> 8]));
}

function tonFriendly(hash: Uint8Array, urlSafe: boolean): string {
  const body = Uint8Array.from([0x11, 0x00, ...hash]);
  const crc = crc16xmodem(body);
  return (urlSafe ? base64urlnopad : base64nopad).encode(Uint8Array.from([...body, crc >> 8, crc & 0xff]));
}

/** Changes one character to another of the same alphabet, which a checksum must catch. */
function typo(address: string, index: number, alphabet: string): string {
  const next = alphabet[(alphabet.indexOf(address[index]) + 1) % alphabet.length];
  return address.slice(0, index) + next + address.slice(index + 1);
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

describe("EVM addresses", () => {
  const checksummed = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

  it("accepts an all-lowercase address and a correctly checksummed one", () => {
    expect(isValidAddress("evm", checksummed.toLowerCase())).toBe(true);
    expect(isValidAddress("evm", checksummed)).toBe(true);
  });

  it("refuses mixed case with a wrong checksum", () => {
    expect(isValidAddress("evm", checksummed.replace("dA", "Da"))).toBe(false);
  });

  it("refuses wrong lengths, missing 0x and non-hex characters", () => {
    expect(isValidAddress("evm", checksummed.slice(0, -1))).toBe(false);
    expect(isValidAddress("evm", checksummed.slice(2))).toBe(false);
    expect(isValidAddress("evm", `0x${"g".repeat(40)}`)).toBe(false);
  });

  it("stores one checksummed spelling of every address", () => {
    expect(canonicalAddress("evm", ` ${checksummed.toLowerCase()} `)).toBe(checksummed);
    expect(canonicalAddress("near", " alice.near ")).toBe("alice.near");
  });
});

describe("Bitcoin addresses", () => {
  it("accepts the genesis address and SegWit v0 and Taproot addresses", () => {
    expect(isValidAddress("bitcoin", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")).toBe(true);
    expect(isValidAddress("bitcoin", segwit("bc", 0, bytes(20)))).toBe(true);
    expect(isValidAddress("bitcoin", segwit("bc", 0, bytes(32)))).toBe(true);
    expect(isValidAddress("bitcoin", segwit("bc", 1, bytes(32)))).toBe(true);
    expect(isValidAddress("bitcoin", base58Check([0x05], bytes(20)))).toBe(true);
  });

  it("accepts an all-uppercase SegWit address and refuses mixed case", () => {
    const address = segwit("bc", 0, bytes(20));
    expect(isValidAddress("bitcoin", address.toUpperCase())).toBe(true);
    expect(isValidAddress("bitcoin", address.slice(0, 10) + address.slice(10).toUpperCase())).toBe(false);
  });

  it("refuses a typo caught by the checksum", () => {
    expect(isValidAddress("bitcoin", typo("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", 10, BASE58))).toBe(false);
    const address = segwit("bc", 0, bytes(20));
    expect(isValidAddress("bitcoin", typo(address, 12, BECH32))).toBe(false);
  });

  it("refuses SegWit v0 in bech32m and v1 in bech32 (BIP-350)", () => {
    expect(isValidAddress("bitcoin", segwit("bc", 0, bytes(20), bech32m))).toBe(false);
    expect(isValidAddress("bitcoin", segwit("bc", 1, bytes(32), bech32))).toBe(false);
  });

  it("refuses wrong program lengths, other networks and other version bytes", () => {
    expect(isValidAddress("bitcoin", segwit("bc", 0, bytes(25)))).toBe(false);
    expect(isValidAddress("bitcoin", segwit("tb", 0, bytes(20)))).toBe(false);
    expect(isValidAddress("bitcoin", segwit("ltc", 0, bytes(20)))).toBe(false);
    expect(isValidAddress("bitcoin", base58Check([0x6f], bytes(20)))).toBe(false);
  });
});

describe("other Bitcoin-family addresses", () => {
  it("accepts Litecoin legacy and SegWit addresses", () => {
    expect(isValidAddress("litecoin", base58Check([0x30], bytes(20)))).toBe(true);
    expect(isValidAddress("litecoin", base58Check([0x32], bytes(20)))).toBe(true);
    expect(isValidAddress("litecoin", segwit("ltc", 0, bytes(20)))).toBe(true);
    expect(isValidAddress("litecoin", base58Check([0x00], bytes(20)))).toBe(false);
  });

  it("accepts Dogecoin and Dash by their version bytes", () => {
    expect(isValidAddress("dogecoin", base58Check([0x1e], bytes(20)))).toBe(true);
    expect(isValidAddress("dogecoin", base58Check([0x30], bytes(20)))).toBe(false);
    expect(isValidAddress("dash", base58Check([0x4c], bytes(20)))).toBe(true);
    expect(isValidAddress("dash", base58Check([0x1e], bytes(20)))).toBe(false);
  });

  it("accepts Zcash t1 and t3 addresses only", () => {
    expect(isValidAddress("zcash", base58Check([0x1c, 0xb8], bytes(20)))).toBe(true);
    expect(isValidAddress("zcash", base58Check([0x1c, 0xbd], bytes(20)))).toBe(true);
    expect(isValidAddress("zcash", base58Check([0x1c, 0xba], bytes(20)))).toBe(false);
  });

  it("accepts Bitcoin Cash CashAddr with or without its prefix, and legacy addresses", () => {
    const cashAddr = "bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a";
    expect(isValidAddress("bitcoincash", cashAddr)).toBe(true);
    expect(isValidAddress("bitcoincash", cashAddr.slice("bitcoincash:".length))).toBe(true);
    expect(isValidAddress("bitcoincash", cashAddr.toUpperCase())).toBe(true);
    expect(isValidAddress("bitcoincash", typo(cashAddr, 20, BECH32))).toBe(false);
    expect(isValidAddress("bitcoincash", "1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu")).toBe(true);
  });
});

describe("account-based chains", () => {
  it("checks TRON base58check addresses with the 0x41 prefix", () => {
    expect(isValidAddress("tron", "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")).toBe(true);
    expect(isValidAddress("tron", typo("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", 8, BASE58))).toBe(false);
    expect(isValidAddress("tron", base58Check([0x41], bytes(21)))).toBe(false);
  });

  it("checks XRP addresses in the XRP alphabet", () => {
    expect(isValidAddress("xrp", "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh")).toBe(true);
    expect(isValidAddress("xrp", "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTi")).toBe(false);
  });

  it("checks Stellar account ids with their CRC16", () => {
    const account = stellarAccount(bytes(32));
    expect(account).toMatch(/^G[A-Z2-7]{55}$/);
    expect(isValidAddress("stellar", account)).toBe(true);
    expect(isValidAddress("stellar", typo(account, 20, "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"))).toBe(false);
  });

  it("checks TON raw and user-friendly addresses", () => {
    expect(isValidAddress("ton", `0:${"ab".repeat(32)}`)).toBe(true);
    expect(isValidAddress("ton", `-1:${"AB".repeat(32)}`)).toBe(true);
    expect(isValidAddress("ton", tonFriendly(bytes(32), true))).toBe(true);
    expect(isValidAddress("ton", tonFriendly(bytes(32), false))).toBe(true);
    const friendly = tonFriendly(bytes(32), true);
    expect(isValidAddress("ton", typo(friendly, 10, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"))).toBe(false);
  });

  it("checks Solana addresses decode to 32 bytes", () => {
    expect(isValidAddress("solana", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBe(true);
    expect(isValidAddress("solana", "So11111111111111111111111111111111111111112")).toBe(true);
    expect(isValidAddress("solana", base58.encode(bytes(31)))).toBe(false);
    expect(isValidAddress("solana", "0OIl".repeat(10))).toBe(false);
  });

  it("checks NEAR named, implicit and ETH-implicit accounts", () => {
    for (const account of ["alice.near", "merchant_1.tg", "a1", "sub.alice.near", "ab".repeat(32), `0x${"ab".repeat(20)}`]) {
      expect(isValidAddress("near", account)).toBe(true);
    }
    for (const account of ["Alice.near", "a", "-alice.near", "alice..near", "alice.near.", `${"a".repeat(65)}`, "al ice.near"]) {
      expect(isValidAddress("near", account)).toBe(false);
    }
  });

  it("checks Sui, Aptos and Starknet hex addresses", () => {
    expect(isValidAddress("sui", `0x${"a".repeat(64)}`)).toBe(true);
    expect(isValidAddress("sui", `0x${"a".repeat(63)}`)).toBe(false);
    expect(isValidAddress("aptos", `0x${"F".repeat(64)}`)).toBe(true);
    expect(isValidAddress("starknet", "0x1")).toBe(true);
    expect(isValidAddress("starknet", `0x${"a".repeat(65)}`)).toBe(false);
  });

  it("checks Cardano Shelley addresses by their bech32 checksum", () => {
    const address = bech32.encode("addr", bech32.toWords(Uint8Array.from([0x01, ...bytes(56)])), 1023);
    expect(isValidAddress("cardano", address)).toBe(true);
    expect(isValidAddress("cardano", typo(address, 30, BECH32))).toBe(false);
    expect(isValidAddress("cardano", bech32.encode("stake", bech32.toWords(bytes(29)), 1023))).toBe(false);
  });
});

describe("isValidAddress input handling", () => {
  it("trims surrounding spaces and refuses empty or very long input", () => {
    expect(isValidAddress("tron", "  TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t\n")).toBe(true);
    expect(isValidAddress("evm", "   ")).toBe(false);
    expect(isValidAddress("cardano", `addr1${"q".repeat(200)}`)).toBe(false);
  });
});
