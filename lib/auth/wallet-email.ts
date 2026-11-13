import { createHash } from "node:crypto";

/** Wallet sign-ins get a placeholder email in a reserved domain, since Better Auth requires one. */
const WALLET_EMAIL_DOMAIN = "wallet.solverr.invalid";

export function placeholderEmail(kind: string, address: string): string {
  const digest = createHash("sha256").update(`${kind}:${address}`).digest("hex").slice(0, 24);
  return `${kind}-${digest}@${WALLET_EMAIL_DOMAIN}`;
}

export function isPlaceholderEmail(email: string): boolean {
  return email.endsWith(`@${WALLET_EMAIL_DOMAIN}`);
}
