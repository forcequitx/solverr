import { sha256 } from "@noble/hashes/sha2.js";
import { createSiweMessage } from "viem/siwe";
import type { WalletKind } from "@/generated/prisma/client";
import { canonicalAddress } from "@/lib/chains/addresses";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { newId, randomToken } from "@/lib/ids";

type ChallengePurpose = "sign_in" | "payout_wallet";

export type WalletChallenge = {
  nonce: string;
  kind: WalletKind;
  address: string;
  chainId?: number;
  purpose: ChallengePurpose;
  /** Merchant the proof is for (payout wallet proofs only). */
  merchantId?: string;
  /** Payout network the proof is for (payout wallet proofs only). */
  payoutChain?: string;
  message: string;
  /** NEP-413 recipient and 32-byte nonce (base64) the NEAR wallet must sign with. */
  near?: { recipient: string; nonce: string };
  expiresAt: string;
};

const TTL_MS = 10 * 60_000;
const IDENTIFIER_PREFIX = "wallet:";
const KIND_NAMES: Record<WalletKind, string> = { evm: "Ethereum", solana: "Solana", near: "NEAR" };

function statementFor(purpose: ChallengePurpose, merchantName?: string): string {
  return purpose === "sign_in"
    ? "Sign in to Solverr."
    : `Use this wallet as the payout wallet for ${merchantName ?? "your business"} on Solverr.`;
}

/** Plain-text sign-in message for Solana and NEAR, following the Sign-In With Solana layout. */
function textMessage(domain: string, uri: string, kind: WalletKind, address: string, statement: string, nonce: string, issuedAt: Date, expiresAt: Date): string {
  return [
    `${domain} wants you to sign in with your ${KIND_NAMES[kind]} account:`,
    address,
    "",
    statement,
    "",
    `URI: ${uri}`,
    "Version: 1",
    "Chain ID: mainnet",
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join("\n");
}

/** Creates a single-use message for the wallet to sign; the server later verifies the exact same text. */
export async function createChallenge(input: {
  kind: WalletKind;
  address: string;
  chainId?: number;
  purpose: ChallengePurpose;
  merchantId?: string;
  merchantName?: string;
  payoutChain?: string;
}): Promise<WalletChallenge> {
  const appUrl = new URL(getEnv().APP_URL);
  const nonce = randomToken(32);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + TTL_MS);
  const statement = statementFor(input.purpose, input.merchantName);
  const address = canonicalAddress(input.kind, input.address);

  const message =
    input.kind === "evm"
      ? createSiweMessage({
          domain: appUrl.host,
          address: address as `0x${string}`,
          statement,
          uri: appUrl.origin,
          version: "1",
          chainId: input.chainId ?? 1,
          nonce,
          issuedAt,
          expirationTime: expiresAt,
        })
      : textMessage(appUrl.host, appUrl.origin, input.kind, address, statement, nonce, issuedAt, expiresAt);

  const challenge: WalletChallenge = {
    nonce,
    kind: input.kind,
    address,
    chainId: input.kind === "evm" ? (input.chainId ?? 1) : undefined,
    purpose: input.purpose,
    merchantId: input.merchantId,
    payoutChain: input.payoutChain,
    message,
    near: input.kind === "near" ? { recipient: appUrl.host, nonce: Buffer.from(sha256(new TextEncoder().encode(nonce))).toString("base64") } : undefined,
    expiresAt: expiresAt.toISOString(),
  };

  await getDb().verification.create({
    data: { id: newId("vrf"), identifier: IDENTIFIER_PREFIX + nonce, value: JSON.stringify(challenge), expiresAt },
  });
  return challenge;
}

/** Returns the challenge once and deletes it, so each signature can be used a single time. */
export async function consumeChallenge(nonce: string): Promise<WalletChallenge | undefined> {
  const db = getDb();
  const record = await db.verification.findFirst({ where: { identifier: IDENTIFIER_PREFIX + nonce } });
  if (!record) return undefined;
  const deleted = await db.verification.deleteMany({ where: { id: record.id } });
  if (deleted.count !== 1 || record.expiresAt < new Date()) return undefined;
  return JSON.parse(record.value) as WalletChallenge;
}
