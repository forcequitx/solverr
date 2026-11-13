import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getEnv } from "@/lib/env";

const VERSION = "v1";
/** A decipher accepts only full 16-byte GCM tags, so a truncated tag cannot pass. */
const AUTH_TAG_LENGTH = 16;

function key(): Buffer {
  return Buffer.from(getEnv().ENCRYPTION_KEY, "base64");
}

/** Encrypts a secret with AES-256-GCM: `v1.<iv>.<tag>.<ciphertext>` (base64url parts). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv, { authTagLength: AUTH_TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
}

/** Decrypts `encryptSecret` output; the ciphertext part is empty for an empty secret, and the auth tag still guards it. */
export function decryptSecret(encoded: string): string {
  const parts = encoded.split(".");
  const [version, iv, tag, ciphertext] = parts;
  if (parts.length !== 4 || version !== VERSION || !iv || !tag || ciphertext === undefined) throw new Error("Unsupported encrypted secret format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"), { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
