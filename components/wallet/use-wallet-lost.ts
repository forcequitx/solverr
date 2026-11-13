"use client";

import { useEffect, useEffectEvent } from "react";
import type { ConnectedWallet } from "@/lib/wallets/client/types";

/** Runs `onLost` when the connected wallet disconnects or switches to another account, so a screen never keeps a stale wallet. */
export function useWalletLost(wallet: ConnectedWallet | null, onLost: () => void) {
  const lost = useEffectEvent(onLost);
  useEffect(() => (wallet ? wallet.watch(() => lost()) : undefined), [wallet]);
}
