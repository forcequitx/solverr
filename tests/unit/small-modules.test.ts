import { createElement, isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { groupsOfFour } from "@/components/checkout/address-groups";
import { CHAINS, chainByName, chainForToken, explorerTxUrl, getChain } from "@/lib/chains/registry";
import { redactUrls } from "@/lib/error-reports";
import { format, formatNodes } from "@/lib/i18n/interpolate";
import { ARRIVED_STATUSES, OPEN_STATUSES, PAYABLE_STATUSES } from "@/lib/invoices/statuses";
import { isTransactionHash } from "@/lib/transfers/onchain";

describe("redactUrls", () => {
  it("keeps only the origin of every URL in error text", () => {
    expect(redactUrls("POST https://api.telegram.org/bot123456:ABC-secret/sendMessage failed")).toBe("POST https://api.telegram.org failed");
    expect(redactUrls("RPC https://base.example/v2/key-abc?x=1 and wss://rpc.example/ws/key timed out")).toBe("RPC https://base.example and wss://rpc.example timed out");
  });

  it("drops a username and password in the URL", () => {
    expect(redactUrls("connect https://user:pass@shop.example/hook")).toBe("connect https://shop.example");
  });

  it("stops at quotes and angle brackets around a URL", () => {
    expect(redactUrls('fetch "https://shop.example/a/b?token=1" refused')).toBe('fetch "https://shop.example" refused');
    expect(redactUrls("<https://shop.example/path>")).toBe("<https://shop.example>");
  });

  it("leaves text without URLs unchanged", () => {
    expect(redactUrls("Invalid query: unique constraint failed")).toBe("Invalid query: unique constraint failed");
  });
});

describe("format", () => {
  it("replaces named placeholders", () => {
    expect(format("Pay {amount} {coin} to {merchant}", { amount: 25, coin: "USDC", merchant: "Northwind" })).toBe("Pay 25 USDC to Northwind");
    expect(format("{n} of {n}", { n: 3 })).toBe("3 of 3");
  });

  it("leaves unknown placeholders and inherited names as written", () => {
    expect(format("Hi {name}", {})).toBe("Hi {name}");
    expect(format("{constructor} {toString}", {})).toBe("{constructor} {toString}");
  });
});

describe("formatNodes", () => {
  it("puts values, including elements, between the text parts", () => {
    const bold = createElement("b", null, "one-time");
    const parts = formatNodes("To this {word} address {missing}", { word: bold });
    expect(parts[0]).toBe("To this ");
    expect((parts[1] as ReactElement<{ children: unknown }>).props.children).toBe(bold);
    expect(parts[2]).toBe(" address ");
    expect((parts[3] as ReactElement<{ children: unknown }>).props.children).toBe("{missing}");
    expect(parts.filter(isValidElement)).toHaveLength(2);
  });
});

describe("invoice status sets", () => {
  it("lists the statuses each set stands for", () => {
    expect([...OPEN_STATUSES].sort()).toEqual(["awaiting_payment", "created", "detected", "processing"]);
    expect([...ARRIVED_STATUSES].sort()).toEqual(["detected", "paid", "processing"]);
    expect([...PAYABLE_STATUSES].sort()).toEqual(["awaiting_payment", "created"]);
  });

  it("keeps payable statuses open, and an underpaid deposit out of arrived", () => {
    for (const status of PAYABLE_STATUSES) expect(OPEN_STATUSES.has(status)).toBe(true);
    expect(ARRIVED_STATUSES.has("underpaid")).toBe(false);
    expect(OPEN_STATUSES.has("paid")).toBe(false);
  });
});

describe("chain registry", () => {
  it("finds the chain of a token by its 1Click blockchain code", () => {
    expect(chainForToken({ blockchain: "base", assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near" })?.name).toBe("Base");
    expect(chainForToken({ blockchain: "sol", assetId: "nep141:sol.omft.near" })?.family).toBe("solana");
  });

  it("returns nothing for a chain Solverr does not support", () => {
    expect(chainForToken({ blockchain: "unknown-chain", assetId: "nep141:x.near" })).toBeUndefined();
  });

  it("takes only ERC-20 tokens of 1Click's hypercore code as HyperEVM, never HyperCore spot tokens", () => {
    expect(chainForToken({ blockchain: "hypercore", assetId: "1cs_v1:hypercore:erc20:0xb88339cb7199b77e23db6e890353e22632ba630f" })?.name).toBe("HyperEVM");
    expect(chainForToken({ blockchain: "hypercore", assetId: "1cs_v1:hypercore:spot:USDC" })).toBeUndefined();
  });

  it("has unique ids and EVM chain ids", () => {
    expect(new Set(CHAINS.map((chain) => chain.id)).size).toBe(CHAINS.length);
    const evmIds = CHAINS.flatMap((chain) => (chain.evmChainId ? [chain.evmChainId] : []));
    expect(new Set(evmIds).size).toBe(evmIds.length);
  });

  it("looks chains up by id and name and builds explorer links with the hash escaped", () => {
    expect(getChain("eth")?.evmChainId).toBe(1);
    expect(chainByName("Solana")?.id).toBe("sol");
    expect(explorerTxUrl(getChain("tron")!, "abc/../x")).toBe("https://tronscan.org/#/transaction/abc%2F..%2Fx");
  });
});

describe("isTransactionHash", () => {
  const evm = getChain("base")!;
  const solana = getChain("sol")!;
  const near = getChain("near")!;

  it("checks EVM hashes as 0x and 64 hex characters in any case", () => {
    expect(isTransactionHash(evm, `0x${"ab".repeat(32)}`)).toBe(true);
    expect(isTransactionHash(evm, `0x${"AB".repeat(32)}`)).toBe(true);
    expect(isTransactionHash(evm, "ab".repeat(32))).toBe(false);
    expect(isTransactionHash(evm, `0x${"ab".repeat(31)}`)).toBe(false);
    expect(isTransactionHash(evm, `0x${"zz".repeat(32)}`)).toBe(false);
  });

  it("checks Solana signatures as 64 to 90 base58 characters", () => {
    expect(isTransactionHash(solana, "5".repeat(88))).toBe(true);
    expect(isTransactionHash(solana, "5".repeat(63))).toBe(false);
    expect(isTransactionHash(solana, `${"5".repeat(87)}0`)).toBe(false);
  });

  it("checks NEAR hashes as 40 to 50 base58 characters", () => {
    expect(isTransactionHash(near, "9".repeat(44))).toBe(true);
    expect(isTransactionHash(near, "9".repeat(39))).toBe(false);
    expect(isTransactionHash(near, `0x${"ab".repeat(32)}`)).toBe(false);
  });

  it("accepts any hash on chains it cannot check", () => {
    expect(isTransactionHash(getChain("btc")!, "anything")).toBe(true);
  });
});

describe("groupsOfFour", () => {
  it("splits text into groups of four", () => {
    expect(groupsOfFour("abcdefgh")).toEqual(["abcd", "efgh"]);
  });

  it("spreads leftover characters over the first groups", () => {
    expect(groupsOfFour("abcdefghi")).toEqual(["abcde", "fghi"]);
    expect(groupsOfFour("abcdefghijklmn")).toEqual(["abcde", "fghij", "klmn"]);
  });

  it("returns nothing for empty text and one group for short text", () => {
    expect(groupsOfFour("")).toEqual([]);
    expect(groupsOfFour("abc")).toEqual(["abc"]);
  });

  it("keeps every character in order and groups of 4 or 5 for deposit-address lengths", () => {
    for (let length = 12; length <= 80; length += 1) {
      const text = Array.from({ length }, (_, index) => String.fromCharCode(65 + (index % 26))).join("");
      const groups = groupsOfFour(text);
      expect(groups.join("")).toBe(text);
      for (const group of groups) expect([4, 5]).toContain(group.length);
    }
  });
});
