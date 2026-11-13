import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/** Swaps one base64url character, keeping the text valid base64url. */
function flipCharacter(part: string, index = 0): string {
  return part.slice(0, index) + (part[index] === "A" ? "B" : "A") + part.slice(index + 1);
}

describe("encryptSecret and decryptSecret", () => {
  it("round-trips text, including non-ASCII characters", () => {
    for (const plain of ["whsec_abc", "café ☕ 東京", JSON.stringify({ token: "cr_123", balance: "10.00" })]) {
      expect(decryptSecret(encryptSecret(plain))).toBe(plain);
    }
  });

  it("round-trips an empty string", () => {
    expect(decryptSecret(encryptSecret(""))).toBe("");
  });

  it("writes v1.<iv>.<tag>.<ciphertext> with a fresh IV each time", () => {
    const first = encryptSecret("same text");
    const second = encryptSecret("same text");
    expect(first).not.toBe(second);
    const [version, iv, tag, ciphertext] = first.split(".");
    expect(version).toBe("v1");
    expect(Buffer.from(iv, "base64url")).toHaveLength(12);
    expect(Buffer.from(tag, "base64url")).toHaveLength(16);
    expect(ciphertext).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first).not.toContain("same text");
  });

  it("detects a changed ciphertext, IV or tag", () => {
    const [version, iv, tag, ciphertext] = encryptSecret("pay 100 to alice").split(".");
    expect(() => decryptSecret([version, iv, tag, flipCharacter(ciphertext)].join("."))).toThrow();
    expect(() => decryptSecret([version, flipCharacter(iv), tag, ciphertext].join("."))).toThrow();
    expect(() => decryptSecret([version, iv, flipCharacter(tag), ciphertext].join("."))).toThrow();
  });

  it("refuses a shortened authentication tag", () => {
    const [version, iv, tag, ciphertext] = encryptSecret("secret").split(".");
    const shortTag = Buffer.from(tag, "base64url").subarray(0, 8).toString("base64url");
    expect(() => decryptSecret([version, iv, shortTag, ciphertext].join("."))).toThrow();
  });

  it("refuses an unknown version or a missing part", () => {
    const [, iv, tag, ciphertext] = encryptSecret("secret").split(".");
    expect(() => decryptSecret(["v2", iv, tag, ciphertext].join("."))).toThrow("Unsupported encrypted secret format");
    expect(() => decryptSecret(["v1", iv, tag].join("."))).toThrow("Unsupported encrypted secret format");
    expect(() => decryptSecret("plain text")).toThrow("Unsupported encrypted secret format");
  });

  it("cannot be read with another ENCRYPTION_KEY", async () => {
    const encrypted = encryptSecret("webhook secret");
    vi.resetModules();
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    const other = await import("@/lib/crypto");
    expect(() => other.decryptSecret(encrypted)).toThrow();
    expect(other.decryptSecret(other.encryptSecret("x"))).toBe("x");
  });
});
