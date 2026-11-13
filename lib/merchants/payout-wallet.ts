import type { Merchant } from "@/generated/prisma/client";
import { CHAINS } from "@/lib/chains/registry";
import type { WalletKind } from "@/lib/wallets/client/types";

/** The merchant's payout wallet as the payout forms show it, or null until a wallet is verified. */
export function verifiedPayout(merchant: Pick<Merchant, "payoutAddress" | "payoutChain" | "payoutVerifiedAt">) {
  return merchant.payoutAddress && merchant.payoutChain && merchant.payoutVerifiedAt
    ? { chain: merchant.payoutChain, address: merchant.payoutAddress, verifiedAt: merchant.payoutVerifiedAt.getTime() }
    : null;
}

/** Key for the payout wallet form: a newly verified wallet, even the same address again, starts the form fresh. */
export const payoutFormKey = (payout: ReturnType<typeof verifiedPayout>) => (payout ? `${payout.chain}:${payout.address}:${payout.verifiedAt}` : "none");

/** Networks a payout wallet can be on, with the wallet family that connects to each. */
export function payoutChainOptions() {
  return CHAINS.filter((chain) => chain.payout).map((chain) => ({ id: chain.id, name: chain.name, family: chain.family as WalletKind }));
}
