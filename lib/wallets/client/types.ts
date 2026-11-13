import { en } from "@/lib/i18n/messages/en";
import type { PaymentInstruction } from "@/lib/wallets/payment-instruction";

export type WalletKind = "evm" | "solana" | "near" | "bitcoin" | "tron" | "ton";

/** Wallet kinds whose signatures Solverr verifies, so they can sign in and prove a payout wallet. */
export type SigningKind = Extract<WalletKind, "evm" | "solana" | "near">;

export function isSigningKind(kind: WalletKind): kind is SigningKind {
  return kind === "evm" || kind === "solana" || kind === "near";
}

type SignedProof = { signature: string; publicKey?: string };

export type ConnectedWallet = {
  kind: WalletKind;
  name: string;
  address: string;
  /** Current EVM chain id, when known. */
  chainId?: number;
  /** Signs a sign-in or ownership message; only EVM, Solana and NEAR wallets can, because only their signatures are verified. */
  signMessage(challenge: { message: string; near?: { recipient: string; nonce: string } | null }): Promise<SignedProof>;
  /** Sends the payment and returns the transaction hash, or null when the wallet does not report one (status polling finds the payment). */
  pay(instruction: PaymentInstruction): Promise<string | null>;
  /** Calls `onLost` when the wallet disconnects or switches to another account; returns a function that stops watching. */
  watch(onLost: () => void): () => void;
  disconnect(): Promise<void>;
};

/** For wallets that can pay but whose signatures Solverr does not verify (Bitcoin, TRON, TON). */
export async function cannotSignIn(): Promise<SignedProof> {
  throw new Error("This wallet can pay, but it cannot sign in or be used as a payout wallet.");
}

/** The person closed the wallet modal without connecting a wallet. */
export class WalletNotConnected extends Error {
  constructor() {
    super(en.walletErrors.notConnected);
    this.name = "WalletNotConnected";
  }
}

type WalletErrorReason = "noConnection" | "unsupportedNetwork" | "unsupportedToken" | "nativeOnly" | "wrongNetwork" | "walletCannotSend";

/** A wallet failure with a reason code, so each page can explain it in its own words; `message` is the plain default from `en.walletErrors`. */
export class WalletError extends Error {
  constructor(
    readonly reason: WalletErrorReason,
    options?: ErrorOptions,
  ) {
    super(en.walletErrors[reason], options);
    this.name = "WalletError";
  }
}
