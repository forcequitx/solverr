import { NetworkBitcoin, NetworkEthereum, NetworkNearProtocol, NetworkSolana, NetworkTon, NetworkTron, WalletWalletConnect } from "@web3icons/react";
import type { ComponentType } from "react";
import type { WalletKind } from "@/lib/wallets/client/types";

type Logo = ComponentType<{ variant?: "mono" | "branded" | "background"; className?: string }>;

/** The logo that stands for each wallet family; EVM wallets are shown with Ethereum's. */
const FAMILY_LOGOS: Record<WalletKind, Logo> = {
  evm: NetworkEthereum,
  solana: NetworkSolana,
  near: NetworkNearProtocol,
  bitcoin: NetworkBitcoin,
  tron: NetworkTron,
  ton: NetworkTon,
};

/** The chain family's logo in a round tile. */
export function ChainLogo({ kind }: { kind: WalletKind }) {
  const Logo = FAMILY_LOGOS[kind];
  return (
    <span aria-hidden="true" className="inline-grid size-9 shrink-0 overflow-hidden rounded-full">
      <Logo variant="background" className="size-full" />
    </span>
  );
}

/** The WalletConnect mark; phone wallets connect through WalletConnect. */
export function WalletConnectLogo({ className = "" }: { className?: string }) {
  return <WalletWalletConnect variant="branded" className={`size-3.5 shrink-0 ${className}`} aria-hidden="true" />;
}
