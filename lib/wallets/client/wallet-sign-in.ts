import type { ConnectedWallet } from "@/lib/wallets/client/types";

/** A refusal from Solverr's own sign-in API, whose message is already written for people. */
export class SignInRefused extends Error {}

/** POSTs JSON to a Solverr sign-in endpoint and returns its answer; a refusal throws `SignInRefused` with its message. */
export async function postSignIn(path: string, body: unknown, failedMessage: string) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new SignInRefused(json?.message ?? failedMessage);
  return json;
}

/** Signs a one-time challenge with `wallet` to start a session (creating the account the first time) or, signed in, link it; `onSign` runs just before. */
export async function walletSignIn(wallet: ConnectedWallet, failedMessage: string, onSign?: () => void): Promise<void> {
  const challenge = await postSignIn("/api/auth/wallet/challenge", { kind: wallet.kind, address: wallet.address, ...(wallet.chainId ? { chain_id: wallet.chainId } : {}) }, failedMessage);
  onSign?.();
  const proof = await wallet.signMessage({ message: challenge.message, near: challenge.near });
  await postSignIn("/api/auth/wallet/verify", { nonce: challenge.nonce, signature: proof.signature, ...(proof.publicKey ? { public_key: proof.publicKey } : {}) }, failedMessage);
}
