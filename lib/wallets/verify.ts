import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import { verifyMessage } from "viem";
import { EVM_CHAIN_BY_ID } from "@/lib/chains/evm-chains";
import { evmClient } from "@/lib/chains/rpc/evm-rpc";
import { hasFullAccessKey } from "@/lib/chains/rpc/near-rpc";
import type { WalletChallenge } from "@/lib/wallets/challenge";

type WalletProof = { signature: string; publicKey?: string };

/** How a signature was accepted: by the key that owns the address, or by the smart wallet's own contract. */
type ProofMethod = "key" | "contract";

/** NEP-413 payloads are prefixed with 2^31 + 413 so they can never be valid transactions. */
const NEP413_TAG = 2 ** 31 + 413;

function u32le(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function borshString(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  return Uint8Array.from([...u32le(bytes.length), ...bytes]);
}

/** SHA-256 of the NEP-413 payload `{ message, nonce, recipient, callbackUrl: None }`. */
function nep413Hash(message: string, nonce: Uint8Array, recipient: string): Uint8Array {
  return sha256(Uint8Array.from([...u32le(NEP413_TAG), ...borshString(message), ...nonce, ...borshString(recipient), 0]));
}

function decodeBase64(value: string): Uint8Array | undefined {
  try {
    return Uint8Array.from(Buffer.from(value, "base64"));
  } catch {
    return undefined;
  }
}

async function verifyNear(challenge: WalletChallenge, proof: WalletProof): Promise<boolean> {
  if (!challenge.near || !proof.publicKey?.startsWith("ed25519:")) return false;
  const publicKey = base58.decode(proof.publicKey.slice("ed25519:".length));
  const signature = decodeBase64(proof.signature);
  const nonce = decodeBase64(challenge.near.nonce);
  if (!signature || signature.length !== 64 || publicKey.length !== 32 || !nonce || nonce.length !== 32) return false;
  if (!ed25519.verify(signature, nep413Hash(challenge.message, nonce, challenge.near.recipient), publicKey)) return false;
  return hasFullAccessKey(challenge.address, proof.publicKey);
}

function verifySolana(challenge: WalletChallenge, proof: WalletProof): boolean {
  const signature = decodeBase64(proof.signature);
  const publicKey = base58.decode(challenge.address);
  if (!signature || signature.length !== 64 || publicKey.length !== 32) return false;
  return ed25519.verify(signature, new TextEncoder().encode(challenge.message), publicKey);
}

/** A key signature is checked offline; a smart wallet (ERC-1271, or ERC-6492 before deployment) is checked by its contract on the challenge's chain. */
async function verifyEvm(challenge: WalletChallenge, proof: WalletProof): Promise<ProofMethod | null> {
  const signed = { address: challenge.address as `0x${string}`, message: challenge.message, signature: proof.signature as `0x${string}` };
  if (await verifyMessage(signed).catch(() => false)) return "key";
  const chain = EVM_CHAIN_BY_ID.get(challenge.chainId ?? 1);
  if (!chain) return null;
  return (await evmClient(chain).verifyMessage(signed)) ? "contract" : null;
}

/** Checks that the wallet signed exactly the challenge message (and, on NEAR, that the key controls the account); null when it did not. */
export async function verifyWalletProof(challenge: WalletChallenge, proof: WalletProof): Promise<ProofMethod | null> {
  try {
    switch (challenge.kind) {
      case "evm":
        return await verifyEvm(challenge, proof);
      case "solana":
        return verifySolana(challenge, proof) ? "key" : null;
      case "near":
        return (await verifyNear(challenge, proof)) ? "key" : null;
    }
  } catch {
    return null;
  }
}
