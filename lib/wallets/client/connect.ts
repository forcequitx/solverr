import { nearDialogOpen, preloadNearConnector } from "@/lib/wallets/client/near";
import { getAppKit, reownModalOpen } from "@/lib/wallets/client/reown";
import type { ConnectedWallet, WalletKind } from "@/lib/wallets/client/types";

/** Opens the connector for one chain family: Reown for EVM, Solana, Bitcoin, TRON and TON, NEAR Connect for NEAR. Each loads only when it is used.
    `signsMessages` says whether the wallet will be asked to sign a message, which some NEAR wallets cannot do. */
export async function connectWallet(kind: WalletKind, { signsMessages }: { signsMessages: boolean }): Promise<ConnectedWallet> {
  switch (kind) {
    case "evm":
      return (await import("@/lib/wallets/client/evm")).connectEvmWallet();
    case "solana":
      return (await import("@/lib/wallets/client/solana")).connectSolanaWallet();
    case "near":
      return (await import("@/lib/wallets/client/near")).connectNearWallet({ signsMessages });
    case "bitcoin":
      return (await import("@/lib/wallets/client/bitcoin")).connectBitcoinWallet();
    case "tron":
      return (await import("@/lib/wallets/client/tron")).connectTronWallet();
    case "ton":
      return (await import("@/lib/wallets/client/ton")).connectTonWallet();
  }
}

/** Starts loading the connectors for `kinds` in the background, so the first click opens a wallet list without a wait. */
export function preloadWalletConnectors(kinds: readonly WalletKind[]): void {
  if (kinds.some((kind) => kind !== "near")) void getAppKit().catch(() => {});
  if (kinds.includes("near")) preloadNearConnector();
}

/** Whether a wallet connector's own dialog is open, so the page leaves key presses such as Escape to it. */
export function walletDialogOpen(): boolean {
  return reownModalOpen() || nearDialogOpen();
}
