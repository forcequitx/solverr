import { randomBytes } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WalletChallenge } from "@/lib/wallets/challenge";
import { verifyWalletProof } from "@/lib/wallets/verify";

type RpcCall = { method: string; params: unknown };

/** Every JSON-RPC request (viem's EVM transport and the NEAR RPC) is answered by `reply`; tests that expect none leave it throwing. */
const unexpected = (call: RpcCall): object => {
  throw new Error(`Unexpected RPC method ${call.method}`);
};
const rpc = { calls: [] as RpcCall[], reply: unexpected };

beforeEach(() => {
  rpc.calls.length = 0;
  rpc.reply = unexpected;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown };
      const call = { method: request.method, params: request.params };
      rpc.calls.push(call);
      return Response.json({ jsonrpc: "2.0", id: request.id, ...rpc.reply(call) });
    }),
  );
});

const ISSUED_AT = new Date("2026-11-11T10:00:00Z");
const EXPIRES_AT = new Date("2026-11-11T10:10:00Z");
const NONCE = "k3Jd9QxV2mT8pLw1Zr6Yc4Hb7Ns5Fa0E";

/** The plain-text sign-in message `createChallenge` builds for Solana and NEAR. */
function textMessage(kind: "Solana" | "NEAR", address: string, nonce = NONCE): string {
  return [
    `localhost:3000 wants you to sign in with your ${kind} account:`,
    address,
    "",
    "Sign in to Solverr.",
    "",
    "URI: http://localhost:3000",
    "Version: 1",
    "Chain ID: mainnet",
    `Nonce: ${nonce}`,
    `Issued At: ${ISSUED_AT.toISOString()}`,
    `Expiration Time: ${EXPIRES_AT.toISOString()}`,
  ].join("\n");
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

describe("verifyWalletProof for EVM", () => {
  const owner = privateKeyToAccount(generatePrivateKey());
  const stranger = privateKeyToAccount(generatePrivateKey());
  const SMART_WALLET = "0x4e59b44847b379578588920cA78FbF26c0B4956C";

  const challengeFor = (address: `0x${string}`, chainId: number | undefined = 8453, nonce = NONCE): WalletChallenge => ({
    nonce,
    kind: "evm",
    address,
    chainId,
    purpose: "sign_in",
    message: createSiweMessage({
      domain: "localhost:3000",
      address,
      statement: "Sign in to Solverr.",
      uri: "http://localhost:3000",
      version: "1",
      chainId: chainId ?? 1,
      nonce,
      issuedAt: ISSUED_AT,
      expirationTime: EXPIRES_AT,
    }),
    expiresAt: EXPIRES_AT.toISOString(),
  });

  /** The ERC-6492 validator `eth_call` answers 0x01 for a valid signature and 0x00 otherwise. */
  const contractAnswers = (valid: boolean) => {
    rpc.reply = (call) => {
      if (call.method !== "eth_call") throw new Error(`Unexpected RPC method ${call.method}`);
      return { result: valid ? "0x01" : "0x00" };
    };
  };

  it("accepts the address's own SIWE signature offline", async () => {
    const challenge = challengeFor(owner.address);
    const signature = await owner.signMessage({ message: challenge.message });
    expect(await verifyWalletProof(challenge, { signature })).toBe("key");
    expect(rpc.calls).toEqual([]);
  });

  it("refuses another key's signature once the chain does not accept it either", async () => {
    contractAnswers(false);
    const challenge = challengeFor(owner.address);
    const signature = await stranger.signMessage({ message: challenge.message });
    expect(await verifyWalletProof(challenge, { signature })).toBeNull();
    expect(rpc.calls.map((call) => call.method)).toEqual(["eth_call"]);
    expect(JSON.stringify(rpc.calls[0].params).toLowerCase()).toContain(owner.address.slice(2).toLowerCase());
  });

  it("refuses a signature of another message, such as one with a changed nonce", async () => {
    contractAnswers(false);
    const signed = challengeFor(owner.address);
    const signature = await owner.signMessage({ message: signed.message });
    expect(await verifyWalletProof(challengeFor(owner.address, 8453, `${NONCE.slice(0, -1)}X`), { signature })).toBeNull();
  });

  it("accepts a smart wallet's signature when its contract on the challenge's chain says it is valid", async () => {
    contractAnswers(true);
    const challenge = challengeFor(SMART_WALLET);
    const signature = await owner.signMessage({ message: challenge.message });
    expect(await verifyWalletProof(challenge, { signature })).toBe("contract");
    expect(rpc.calls.map((call) => call.method)).toEqual(["eth_call"]);
    expect(JSON.stringify(rpc.calls[0].params).toLowerCase()).toContain(SMART_WALLET.slice(2).toLowerCase());
  });

  it("refuses a smart-wallet signature on a network it has no client for without asking any chain", async () => {
    const challenge = challengeFor(SMART_WALLET, 1_234_567);
    const signature = await owner.signMessage({ message: challenge.message });
    expect(await verifyWalletProof(challenge, { signature })).toBeNull();
    expect(rpc.calls).toEqual([]);
  });

  it("refuses a malformed signature and an unreachable chain instead of throwing", async () => {
    contractAnswers(false);
    const challenge = challengeFor(owner.address);
    expect(await verifyWalletProof(challenge, { signature: "not a signature" })).toBeNull();
    rpc.reply = () => ({ error: { code: -32601, message: "method not found" } });
    const signature = await stranger.signMessage({ message: challenge.message });
    expect(await verifyWalletProof(challenge, { signature })).toBeNull();
  });
});

describe("verifyWalletProof for Solana", () => {
  const owner = ed25519.keygen();
  const stranger = ed25519.keygen();
  const ADDRESS = base58.encode(owner.publicKey);

  const challengeFor = (message = textMessage("Solana", ADDRESS), address = ADDRESS): WalletChallenge => ({
    nonce: NONCE,
    kind: "solana",
    address,
    purpose: "sign_in",
    message,
    expiresAt: EXPIRES_AT.toISOString(),
  });
  const sign = (message: string, secretKey = owner.secretKey) => base64(ed25519.sign(new TextEncoder().encode(message), secretKey));

  it("accepts the address's own signature of the exact message", async () => {
    const challenge = challengeFor();
    expect(await verifyWalletProof(challenge, { signature: sign(challenge.message) })).toBe("key");
    expect(rpc.calls).toEqual([]);
  });

  it("refuses another key's signature", async () => {
    const challenge = challengeFor();
    expect(await verifyWalletProof(challenge, { signature: sign(challenge.message, stranger.secretKey) })).toBeNull();
  });

  it("refuses a signature of another message or of a changed nonce", async () => {
    const signature = sign(textMessage("Solana", ADDRESS));
    expect(await verifyWalletProof(challengeFor(textMessage("Solana", ADDRESS, `${NONCE.slice(0, -1)}X`)), { signature })).toBeNull();
    expect(await verifyWalletProof(challengeFor(`${textMessage("Solana", ADDRESS)}\n`), { signature })).toBeNull();
  });

  it("refuses a signature of the wrong length and an address that is not a public key", async () => {
    const challenge = challengeFor();
    const signature = ed25519.sign(new TextEncoder().encode(challenge.message), owner.secretKey);
    expect(await verifyWalletProof(challenge, { signature: base64(signature.slice(0, 63)) })).toBeNull();
    expect(await verifyWalletProof(challengeFor(undefined, "0OIl-not-base58"), { signature: base64(signature) })).toBeNull();
    expect(await verifyWalletProof(challengeFor(undefined, base58.encode(owner.publicKey.slice(0, 31))), { signature: base64(signature) })).toBeNull();
  });
});

describe("verifyWalletProof for NEAR", () => {
  const owner = ed25519.keygen();
  const stranger = ed25519.keygen();
  const ACCOUNT = "shop.near";
  const PUBLIC_KEY = `ed25519:${base58.encode(owner.publicKey)}`;
  const RECIPIENT = "localhost:3000";
  const NEP413_NONCE = sha256(new TextEncoder().encode(NONCE));

  const challengeFor = (overrides: Partial<WalletChallenge> = {}): WalletChallenge => ({
    nonce: NONCE,
    kind: "near",
    address: ACCOUNT,
    purpose: "sign_in",
    message: textMessage("NEAR", ACCOUNT),
    near: { recipient: RECIPIENT, nonce: base64(NEP413_NONCE) },
    expiresAt: EXPIRES_AT.toISOString(),
    ...overrides,
  });

  /** Borsh string: u32 little-endian byte length, then UTF-8 bytes. */
  const borshString = (value: string) => {
    const bytes = Buffer.from(value, "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32LE(bytes.length);
    return Buffer.concat([length, bytes]);
  };

  /** What a NEP-413 wallet signs: SHA-256 of tag 2^31 + 413, then Borsh `{ message, nonce: [u8; 32], recipient, callbackUrl: None }`. */
  function nep413Signature(message: string, nonce: Uint8Array, recipient: string, secretKey = owner.secretKey): string {
    const tag = Buffer.alloc(4);
    tag.writeUInt32LE(2_147_484_061);
    const payload = Buffer.concat([tag, borshString(message), Buffer.from(nonce), borshString(recipient), Buffer.from([0])]);
    return base64(ed25519.sign(sha256(payload), secretKey));
  }

  /** The `view_access_key` answer for `permission`, or an RPC error when the key is not on the account. */
  const accessKey = (permission: unknown) => {
    rpc.reply = (call) => {
      if (call.method !== "query") throw new Error(`Unexpected RPC method ${call.method}`);
      return permission === undefined
        ? { error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCESS_KEY" } } }
        : { result: { nonce: 7, permission, block_height: 1, block_hash: "x" } };
    };
  };

  const validSignature = () => nep413Signature(textMessage("NEAR", ACCOUNT), NEP413_NONCE, RECIPIENT);

  it("accepts a NEP-413 signature by a full-access key of the account", async () => {
    accessKey("FullAccess");
    expect(await verifyWalletProof(challengeFor(), { signature: validSignature(), publicKey: PUBLIC_KEY })).toBe("key");
    expect(rpc.calls).toEqual([
      { method: "query", params: { request_type: "view_access_key", finality: "final", account_id: ACCOUNT, public_key: PUBLIC_KEY } },
    ]);
  });

  it("refuses a function-call key and a key the account does not have", async () => {
    accessKey({ FunctionCall: { allowance: "250000000000000000000000", receiver_id: "app.near", method_names: [] } });
    expect(await verifyWalletProof(challengeFor(), { signature: validSignature(), publicKey: PUBLIC_KEY })).toBeNull();
    accessKey(undefined);
    expect(await verifyWalletProof(challengeFor(), { signature: validSignature(), publicKey: PUBLIC_KEY })).toBeNull();
  });

  it("refuses a signature by a key other than the one presented, without asking the RPC", async () => {
    const signature = nep413Signature(textMessage("NEAR", ACCOUNT), NEP413_NONCE, RECIPIENT, stranger.secretKey);
    expect(await verifyWalletProof(challengeFor(), { signature, publicKey: PUBLIC_KEY })).toBeNull();
    expect(rpc.calls).toEqual([]);
  });

  it("refuses a signature of another message, nonce or recipient", async () => {
    const signature = validSignature();
    const otherNonce = base64(sha256(new TextEncoder().encode(`${NONCE}X`)));
    expect(await verifyWalletProof(challengeFor({ message: textMessage("NEAR", ACCOUNT, `${NONCE.slice(0, -1)}X`) }), { signature, publicKey: PUBLIC_KEY })).toBeNull();
    expect(await verifyWalletProof(challengeFor({ near: { recipient: RECIPIENT, nonce: otherNonce } }), { signature, publicKey: PUBLIC_KEY })).toBeNull();
    expect(await verifyWalletProof(challengeFor({ near: { recipient: "evil.example", nonce: base64(NEP413_NONCE) } }), { signature, publicKey: PUBLIC_KEY })).toBeNull();
    expect(rpc.calls).toEqual([]);
  });

  it("refuses a plain signature of the message that is not a NEP-413 payload", async () => {
    const signature = base64(ed25519.sign(new TextEncoder().encode(textMessage("NEAR", ACCOUNT)), owner.secretKey));
    expect(await verifyWalletProof(challengeFor(), { signature, publicKey: PUBLIC_KEY })).toBeNull();
  });

  it("refuses a missing or non-ed25519 key, a short nonce and a challenge without NEP-413 data", async () => {
    const signature = validSignature();
    expect(await verifyWalletProof(challengeFor(), { signature })).toBeNull();
    expect(await verifyWalletProof(challengeFor(), { signature, publicKey: `secp256k1:${base58.encode(owner.publicKey)}` })).toBeNull();
    expect(await verifyWalletProof(challengeFor({ near: { recipient: RECIPIENT, nonce: base64(randomBytes(16)) } }), { signature, publicKey: PUBLIC_KEY })).toBeNull();
    expect(await verifyWalletProof(challengeFor({ near: undefined }), { signature, publicKey: PUBLIC_KEY })).toBeNull();
    expect(rpc.calls).toEqual([]);
  });

  it("refuses instead of throwing when the NEAR RPC cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("busy", { status: 503 })));
    expect(await verifyWalletProof(challengeFor(), { signature: validSignature(), publicKey: PUBLIC_KEY })).toBeNull();
  });
});
