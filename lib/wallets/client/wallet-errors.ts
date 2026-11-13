import { en } from "@/lib/i18n/messages/en";
import { WalletError, WalletNotConnected } from "@/lib/wallets/client/types";

type ErrorLike = { name?: unknown; code?: unknown; message?: unknown; shortMessage?: unknown; cause?: unknown };

/** What went wrong with a wallet request. */
type WalletFailure = "notConnected" | "noConnection" | "rejected" | "insufficientFunds" | "wrongNetwork" | "walletCannotSend" | "unsupported";

const REJECTED_NAMES = new Set(["UserRejectedRequestError", "UserRejectsError"]);
const REJECTED_TEXT = /user (rejected|denied|declined|cancell?ed)|rejected by (the )?user|declined by (the )?user/i;
const NETWORK_NAMES = new Set(["ChainMismatchError", "SwitchChainError", "ChainNotConfiguredError"]);
const INSUFFICIENT_TEXT = /insufficient (funds|balance)|not enough balance|exceeds balance/i;
/** EIP-1193 code for a request the person declined in the wallet. */
const USER_REJECTED_CODE = 4001;
const MAX_DEPTH = 6;
/** Technical text shown behind "Details" is cut to this length. */
const MAX_DETAILS = 600;

/** The error and the errors it wraps (`cause`), outermost first; libraries such as viem wrap the wallet's own error. */
function chain(cause: unknown): ErrorLike[] {
  const errors: ErrorLike[] = [];
  let current = cause;
  while (typeof current === "object" && current !== null && errors.length < MAX_DEPTH) {
    errors.push(current as ErrorLike);
    current = (current as ErrorLike).cause;
  }
  return errors;
}

const text = (error: ErrorLike) => `${typeof error.shortMessage === "string" ? error.shortMessage : ""} ${typeof error.message === "string" ? error.message : ""}`;

/** Classifies a failed wallet connect, signature or payment. */
export function walletFailure(cause: unknown): WalletFailure | null {
  if (cause instanceof WalletNotConnected) return "notConnected";
  if (cause instanceof WalletError && cause.reason === "noConnection") return "noConnection";
  if (cause instanceof WalletError && cause.reason === "walletCannotSend") return "walletCannotSend";
  const errors = chain(cause);
  if (errors.some((error) => error.code === USER_REJECTED_CODE || REJECTED_NAMES.has(String(error.name)) || REJECTED_TEXT.test(text(error)))) return "rejected";
  if (errors.some((error) => error.name === "InsufficientFundsError" || INSUFFICIENT_TEXT.test(text(error)))) return "insufficientFunds";
  if (errors.some((error) => (error instanceof WalletError && error.reason === "wrongNetwork") || NETWORK_NAMES.has(String(error.name)))) return "wrongNetwork";
  return cause instanceof WalletError ? "unsupported" : null;
}

/** A failed wallet request as one plain sentence for the dashboard and sign-in; unknown errors show `fallback`, never the library's text. */
export function walletErrorMessage(cause: unknown, fallback: string): string {
  const failure = walletFailure(cause);
  if (failure === null) return fallback;
  return en.walletErrors[failure === "unsupported" ? (cause as WalletError).reason : failure];
}

/** The library's own text for an unknown wallet failure, for the "Details" of an error; null for failures already explained in plain words. */
export function walletErrorDetails(cause: unknown): string | null {
  if (walletFailure(cause) !== null) return null;
  const errors = chain(cause);
  const raw = errors.map(text).find((value) => value.trim()) ?? "";
  return raw.trim().slice(0, MAX_DETAILS) || null;
}
